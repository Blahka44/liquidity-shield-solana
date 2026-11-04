use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use sha2::{Digest, Sha256};

declare_id!("7mgbZq9YseuJpMhnRAthiz6t8i2iLVFgwG9gjkvhHRoH");

const POLICY_HASH_DOMAIN: &[u8] = b"LIQUIDITY_SHIELD_POLICY_V1";

#[program]
pub mod liquidity_shield_solana {
    use super::*;

    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        max_risk_score: u64,
        allowed_actions: u16,
    ) -> Result<()> {
        validate_policy(max_risk_score, allowed_actions)?;

        let policy = &mut ctx.accounts.policy;
        policy.authority = ctx.accounts.authority.key();
        policy.version = 1;
        policy.max_risk_score = max_risk_score;
        policy.allowed_actions = allowed_actions;
        policy.bump = ctx.bumps.policy;
        policy.policy_hash = hash_policy(policy);

        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        max_risk_score: u64,
        allowed_actions: u16,
    ) -> Result<()> {
        validate_policy(max_risk_score, allowed_actions)?;

        let policy = &mut ctx.accounts.policy;
        policy.version = policy
            .version
            .checked_add(1)
            .ok_or(ErrorCode::PolicyVersionOverflow)?;
        policy.max_risk_score = max_risk_score;
        policy.allowed_actions = allowed_actions;
        policy.policy_hash = hash_policy(policy);

        Ok(())
    }

    // Register an SPL Token account owned by the vault-authority PDA.
    // The PDA, rather than an operator, controls the protected funds.
    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.source_token_account.owner,
            ctx.accounts.vault_authority.key(),
            ErrorCode::WrongVaultAuthority
        );

        let vault = &mut ctx.accounts.vault;
        vault.policy = ctx.accounts.policy.key();
        vault.source_token_account = ctx.accounts.source_token_account.key();
        vault.authority_bump = ctx.bumps.vault_authority;

        Ok(())
    }

    // This is the sole protected transfer path. Policy is evaluated before
    // the Token CPI. A rejection records REJECTED and returns Ok so the
    // immutable attestation is not reverted.
    pub fn guarded_transfer(
        ctx: Context<GuardedTransfer>,
        proposal_id: [u8; 32],
        risk_score: u64,
        action: ActionType,
        raw_input_json: String,
        amount: u64,
    ) -> Result<()> {
        let policy = &ctx.accounts.policy;

        let raw_input_hash = sha256(&[raw_input_json.as_bytes()]);
        let decision_hash = sha256(&[
            raw_input_json.as_bytes(),
            &policy.policy_hash,
            &[action.tag()],
        ]);

        let approved = risk_score <= 100
            && risk_score <= policy.max_risk_score
            && policy.allows(action)
            && action.supports_transfer()
            && amount > 0;

        if !approved {
            write_decision(
                &mut ctx.accounts.decision_record,
                policy.key(),
                ctx.accounts.agent.key(),
                proposal_id,
                risk_score,
                action,
                raw_input_hash,
                decision_hash,
                policy.policy_hash,
                Outcome::Rejected,
                ctx.bumps.decision_record,
            )?;

            emit!(DecisionAttested {
                decision_record: ctx.accounts.decision_record.key(),
                outcome: Outcome::Rejected,
                decision_hash,
            });

            return Ok(());
        }

        let vault_key = ctx.accounts.vault.key();
        let authority_bump = [ctx.accounts.vault.authority_bump];
        let signer_seeds: &[&[u8]] = &[
            b"vault_authority",
            vault_key.as_ref(),
            &authority_bump,
        ];

        let transfer_accounts = Transfer {
            from: ctx.accounts.source_token_account.to_account_info(),
            to: ctx.accounts.destination_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_accounts,
                &[signer_seeds],
            ),
            amount,
        )?;

        write_decision(
            &mut ctx.accounts.decision_record,
            policy.key(),
            ctx.accounts.agent.key(),
            proposal_id,
            risk_score,
            action,
            raw_input_hash,
            decision_hash,
            policy.policy_hash,
            Outcome::Executed,
            ctx.bumps.decision_record,
        )?;

        emit!(DecisionAttested {
            decision_record: ctx.accounts.decision_record.key(),
            outcome: Outcome::Executed,
            decision_hash,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Policy::INIT_SPACE,
        seeds = [b"policy", authority.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, Policy>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        seeds = [b"policy", authority.key().as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, Policy>,
}

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority,
        seeds = [b"policy", authority.key().as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, Policy>,

    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", policy.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: This PDA signs only the protected SPL Token CPI.
    #[account(
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = source_token_account.owner == vault_authority.key()
            @ ErrorCode::WrongVaultAuthority
    )]
    pub source_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32])]
pub struct GuardedTransfer<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        seeds = [b"policy", policy.authority.as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, Policy>,

    #[account(
        has_one = policy,
        seeds = [b"vault", policy.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Constrained PDA used only as the Token CPI signer.
    #[account(
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump = vault.authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = vault.source_token_account @ ErrorCode::WrongSourceTokenAccount,
        constraint = source_token_account.owner == vault_authority.key()
            @ ErrorCode::WrongVaultAuthority
    )]
    pub source_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = destination_token_account.mint == source_token_account.mint
            @ ErrorCode::MintMismatch
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = agent,
        space = 8 + DecisionRecord::INIT_SPACE,
        seeds = [b"decision", policy.key().as_ref(), proposal_id.as_ref()],
        bump
    )]
    pub decision_record: Account<'info, DecisionRecord>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub authority: Pubkey,
    pub version: u64,
    pub max_risk_score: u64,
    pub allowed_actions: u16,
    pub policy_hash: [u8; 32],
    pub bump: u8,
}

impl Policy {
    fn allows(&self, action: ActionType) -> bool {
        (self.allowed_actions & action.bit()) != 0
    }
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub policy: Pubkey,
    pub source_token_account: Pubkey,
    pub authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DecisionRecord {
    pub policy: Pubkey,
    pub agent_id: Pubkey,
    pub proposal_id: [u8; 32],
    pub risk_score: u64,
    pub action: ActionType,
    pub raw_input_hash: [u8; 32],
    pub decision_hash: [u8; 32],
    pub policy_hash: [u8; 32],
    pub outcome: Outcome,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ActionType {
    Pause,
    Move,
    Rebalance,
    Hold,
}

impl ActionType {
    fn tag(self) -> u8 {
        match self {
            Self::Pause => 0,
            Self::Move => 1,
            Self::Rebalance => 2,
            Self::Hold => 3,
        }
    }

    fn bit(self) -> u16 {
        1 << self.tag()
    }

    fn supports_transfer(self) -> bool {
        matches!(self, Self::Move | Self::Rebalance)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Executed,
    Rejected,
}

#[event]
pub struct DecisionAttested {
    pub decision_record: Pubkey,
    pub outcome: Outcome,
    pub decision_hash: [u8; 32],
}

#[error_code]
pub enum ErrorCode {
    #[msg("Risk threshold must be between 0 and 100.")]
    InvalidRiskThreshold,
    #[msg("At least one action must be enabled.")]
    EmptyActionSet,
    #[msg("Policy version overflowed.")]
    PolicyVersionOverflow,
    #[msg("The vault source token account is not owned by the vault authority PDA.")]
    WrongVaultAuthority,
    #[msg("The token account is not the vault's registered source account.")]
    WrongSourceTokenAccount,
    #[msg("Source and destination token mints differ.")]
    MintMismatch,
}

fn validate_policy(max_risk_score: u64, allowed_actions: u16) -> Result<()> {
    require!(max_risk_score <= 100, ErrorCode::InvalidRiskThreshold);
    require!(allowed_actions != 0, ErrorCode::EmptyActionSet);
    Ok(())
}

fn hash_policy(policy: &Policy) -> [u8; 32] {
    sha256(&[
        POLICY_HASH_DOMAIN,
        &policy.version.to_le_bytes(),
        &policy.max_risk_score.to_le_bytes(),
        &policy.allowed_actions.to_le_bytes(),
    ])
}

// SHA256(raw_input_json UTF-8 bytes || policy_hash || action tag).
fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();

    for part in parts {
        hasher.update(part);
    }

    hasher.finalize().into()
}

#[allow(clippy::too_many_arguments)]
fn write_decision(
    record: &mut Account<DecisionRecord>,
    policy: Pubkey,
    agent_id: Pubkey,
    proposal_id: [u8; 32],
    risk_score: u64,
    action: ActionType,
    raw_input_hash: [u8; 32],
    decision_hash: [u8; 32],
    policy_hash: [u8; 32],
    outcome: Outcome,
    bump: u8,
) -> Result<()> {
    record.policy = policy;
    record.agent_id = agent_id;
    record.proposal_id = proposal_id;
    record.risk_score = risk_score;
    record.action = action;
    record.raw_input_hash = raw_input_hash;
    record.decision_hash = decision_hash;
    record.policy_hash = policy_hash;
    record.outcome = outcome;
    record.timestamp = Clock::get()?.unix_timestamp;
    record.bump = bump;

    Ok(())
}
