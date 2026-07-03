// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IIdentityVerifier.sol";
import "../interfaces/IAnkaraNFT.sol";

/**
 * @title AnkaraNFTBase
 * @author Cranebolt Technologies
 * @notice Abstract base inherited by all Ankara Chain NFT asset record templates.
 *
 * Provides:
 * - ERC-721 with mint, burn, pause
 * - Role-based access control (MINTER, PAUSER, UPGRADER, MANAGER)
 * - Pluggable identity verifier hook (optional — address(0) = open)
 * - Asset lifecycle status (DRAFT → ACTIVE → SUSPENDED → REDEEMED/EXPIRED)
 * - Optional link to a corresponding ERC-20 investment token
 * - UUPS upgradeable proxy
 *
 * Deploy via NFTFactory only. Never deploy this directly.
 */
abstract contract AnkaraNFTBase is
    Initializable,
    ERC721Upgradeable,
    ERC721PausableUpgradeable,
    ERC721BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IAnkaraNFT
{
    // ─── Roles ─────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");

    // ─── State ─────────────────────────────────────────────────────────────
    bytes32 private _assetId;
    string  private _countryCode;
    AssetStatus private _status;
    IIdentityVerifier private _identityVerifier;

    // ERC-20 investment token linked to this NFT deed (address(0) if standalone)
    address public linkedERC20;

    // Token ID counter — starts at 1, increments before each mint
    uint256 private _nextTokenId;

    // ─── Storage gap — 49 slots (50 total - 1 used by linkedERC20 declaration above) ──
    uint256[49] private __gap;

    // ─── Errors ─────────────────────────────────────────────────────────────
    error NotVerified(address account);
    error ZeroAddress();

    // ─── Initializer ────────────────────────────────────────────────────────

    function __AnkaraNFTBase_init(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_
    ) internal onlyInitializing {
        __ERC721_init(name_, symbol_);
        __ERC721Pausable_init();
        __ERC721Burnable_init();
        __AccessControl_init();

        if (admin_ == address(0)) revert ZeroAddress();

        _assetId      = assetId_;
        _countryCode  = countryCode_;
        _status       = AssetStatus.DRAFT;
        _nextTokenId  = 1;

        if (verifier_ != address(0)) {
            _identityVerifier = IIdentityVerifier(verifier_);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE,        admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(UPGRADER_ROLE,      admin_);
        _grantRole(MANAGER_ROLE,       admin_);
    }

    // ─── IAnkaraNFT ────────────────────────────────────────────────────────

    function assetId() external view override returns (bytes32) {
        return _assetId;
    }

    function countryCode() external view override returns (string memory) {
        return _countryCode;
    }

    function status() external view override returns (AssetStatus) {
        return _status;
    }

    function identityVerifier() external view override returns (address) {
        return address(_identityVerifier);
    }

    function setStatus(AssetStatus newStatus)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        _setStatus(newStatus);
    }

    function _setStatus(AssetStatus newStatus) internal {
        AssetStatus old = _status;
        _status = newStatus;
        emit AssetStatusChanged(old, newStatus, block.timestamp);
    }

    function setIdentityVerifier(address verifier)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        address old = address(_identityVerifier);
        _identityVerifier = IIdentityVerifier(verifier);
        emit IdentityVerifierUpdated(old, verifier);
    }

    function pause() external override onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external override onlyRole(PAUSER_ROLE) { _unpause(); }

    function linkToERC20(address erc20Address)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        linkedERC20 = erc20Address;
        emit ERC20Linked(erc20Address);
    }

    // ─── Internal mint helper ────────────────────────────────────────────────

    function _mintNext(address to) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _checkVerified(to);
        _safeMint(to, tokenId);
    }

    // ─── Transfer hook — runs on every mint, burn, transfer ─────────────────
    // OZ v5 ERC-721: _update(to, tokenId, auth) — "from" derived via _ownerOf

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override(ERC721Upgradeable, ERC721PausableUpgradeable) returns (address) {
        address from = _ownerOf(tokenId);
        // Minting (from == address(0)) skips identity check on sender
        if (from != address(0) && address(_identityVerifier) != address(0)) {
            _checkVerified(from);
        }
        // Always check receiver if verifier set (except burns)
        if (to != address(0) && address(_identityVerifier) != address(0)) {
            _checkVerified(to);
        }
        return super._update(to, tokenId, auth);
    }

    function _checkVerified(address account) internal view {
        if (
            address(_identityVerifier) != address(0) &&
            !_identityVerifier.isVerified(account)
        ) {
            revert NotVerified(account);
        }
    }

    // ─── UUPS ───────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}

    // ─── ERC-165 ────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
