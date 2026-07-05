use soroban_sdk::{contracttype, panic_with_error, BytesN, Env, String, Symbol};

use crate::errors::CommonError;
use crate::roles::{require_role, Role};

/// Direct port of Solidity's `AssetStatus` lifecycle enum shared by every
/// EVM template (`DRAFT -> ACTIVE -> SUSPENDED -> REDEEMED/EXPIRED`).
#[contracttype]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AssetStatus {
    Draft,
    Active,
    Suspended,
    Redeemed,
    Expired,
}

#[contracttype]
enum AssetDataKey {
    AssetId,
    CountryCode,
    Status,
    MetadataVersion,
    FeeRecipient,
    LinkedNft,
    LinkedErc20,
}

/// Common asset-record fields shared by every fungible/NFT template,
/// mirroring the non-ERC20 state on `AnkaraChainBaseToken`
/// (`_assetId`, `_countryCode`, `_status`, `feeRecipient`, `linkedNFT`).
pub fn init_asset(
    env: &Env,
    asset_id: &BytesN<32>,
    country_code: &String,
    fee_recipient: &Option<soroban_sdk::Address>,
) {
    if env.storage().instance().has(&AssetDataKey::AssetId) {
        panic_with_error!(env, CommonError::AlreadyInitialized);
    }
    env.storage()
        .instance()
        .set(&AssetDataKey::AssetId, asset_id);
    env.storage()
        .instance()
        .set(&AssetDataKey::CountryCode, country_code);
    env.storage()
        .instance()
        .set(&AssetDataKey::Status, &AssetStatus::Draft);
    env.storage()
        .instance()
        .set(&AssetDataKey::MetadataVersion, &1u32);
    if let Some(fr) = fee_recipient {
        env.storage()
            .instance()
            .set(&AssetDataKey::FeeRecipient, fr);
    }
}

pub fn asset_id(env: &Env) -> BytesN<32> {
    env.storage().instance().get(&AssetDataKey::AssetId).unwrap()
}

pub fn country_code(env: &Env) -> String {
    env.storage()
        .instance()
        .get(&AssetDataKey::CountryCode)
        .unwrap()
}

pub fn status(env: &Env) -> AssetStatus {
    env.storage().instance().get(&AssetDataKey::Status).unwrap()
}

pub fn fee_recipient(env: &Env) -> Option<soroban_sdk::Address> {
    env.storage().instance().get(&AssetDataKey::FeeRecipient)
}

/// Sets asset status. Caller must have already checked `Role::Manager`
/// (each contract calls `require_role(env, Role::Manager)` itself so the
/// auth check appears once at each public entry point, matching Solidity's
/// `onlyRole(MANAGER_ROLE)` modifier placement).
pub fn set_status(env: &Env, new_status: AssetStatus) {
    env.storage()
        .instance()
        .set(&AssetDataKey::Status, &new_status);
    env.events()
        .publish((Symbol::new(env, "status"),), new_status);
}

pub fn set_status_gated(env: &Env, new_status: AssetStatus) {
    require_role(env, Role::Manager);
    set_status(env, new_status);
}

pub fn metadata_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&AssetDataKey::MetadataVersion)
        .unwrap_or(0)
}

/// Bumps and returns the new metadata version, emitting the shared
/// `metadata_updated` event — mirrors every template's
/// `MetadataUpdated(version, timestamp)` event.
pub fn bump_metadata_version(env: &Env) -> u32 {
    let version = metadata_version(env) + 1;
    env.storage()
        .instance()
        .set(&AssetDataKey::MetadataVersion, &version);
    env.events().publish(
        (Symbol::new(env, "metadata_updated"),),
        (version, env.ledger().timestamp()),
    );
    version
}

pub fn linked_nft(env: &Env) -> Option<soroban_sdk::Address> {
    env.storage().instance().get(&AssetDataKey::LinkedNft)
}

/// Sets the companion NFT deed contract for this token, mirroring
/// `linkToNFT()` [MANAGER_ROLE] on `AnkaraChainBaseToken.sol`.
pub fn link_nft(env: &Env, nft_address: &soroban_sdk::Address) {
    require_role(env, Role::Manager);
    env.storage()
        .instance()
        .set(&AssetDataKey::LinkedNft, nft_address);
    env.events()
        .publish((Symbol::new(env, "nft_linked"),), nft_address.clone());
}

pub fn linked_erc20(env: &Env) -> Option<soroban_sdk::Address> {
    env.storage().instance().get(&AssetDataKey::LinkedErc20)
}

/// Sets the companion fungible investment token for this NFT deed,
/// mirroring `linkToERC20()` [MANAGER_ROLE] on `AnkaraNFTBase.sol`.
pub fn link_erc20(env: &Env, erc20_address: &soroban_sdk::Address) {
    require_role(env, Role::Manager);
    env.storage()
        .instance()
        .set(&AssetDataKey::LinkedErc20, erc20_address);
    env.events()
        .publish((Symbol::new(env, "erc20_linked"),), erc20_address.clone());
}
