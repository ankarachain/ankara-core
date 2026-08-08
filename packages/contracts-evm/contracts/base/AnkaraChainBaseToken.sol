// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IIdentityVerifier.sol";
import "../interfaces/IAnkaraChainToken.sol";

/**
 * @title AnkaraChainBaseToken
 * @author PIE Drops Studio
 * @notice Base ERC-20 contract inherited by all Ankara Chain asset templates.
 *
 * Provides:
 * - ERC-20 with mint, burn, pause
 * - Role-based access control (MINTER, PAUSER, UPGRADER, MANAGER)
 * - Pluggable identity verifier hook (optional — address(0) = open)
 * - Asset lifecycle status (DRAFT → ACTIVE → SUSPENDED → REDEEMED/EXPIRED)
 * - UUPS upgradeable proxy — fix bugs without redeploying token
 *
 * Deploy via TokenFactory only. Never deploy this directly.
 */
abstract contract AnkaraChainBaseToken is
    Initializable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    ERC20BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IAnkaraChainToken
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
    address public feeRecipient;

    // NFT deed contract linked to this investment token (address(0) if standalone)
    address public linkedNFT;

    // ─── Storage gap — 49 slots (50 - 1 used by linkedNFT) ────────────────
    uint256[49] private __gap;

    // ─── Events ─────────────────────────────────────────────────────────────
    event NFTLinked(address indexed nftAddress);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error NotVerified(address account);
    error ZeroAddress();

    // ─── Initializer ────────────────────────────────────────────────────────

    function __AnkaraChainBaseToken_init(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_
    ) internal onlyInitializing {
        __ERC20_init(name_, symbol_);
        __ERC20Pausable_init();
        __ERC20Burnable_init();
        __AccessControl_init();

        if (admin_ == address(0)) revert ZeroAddress();

        _assetId      = assetId_;
        _countryCode  = countryCode_;
        _status       = AssetStatus.DRAFT;
        feeRecipient  = feeRecipient_;

        if (verifier_ != address(0)) {
            _identityVerifier = IIdentityVerifier(verifier_);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE,        admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(UPGRADER_ROLE,      admin_);
        _grantRole(MANAGER_ROLE,       admin_);
    }

    // ─── IAnkaraChainToken ─────────────────────────────────────────────────

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

    function linkToNFT(address nftAddress)
        external
        onlyRole(MANAGER_ROLE)
    {
        linkedNFT = nftAddress;
        emit NFTLinked(nftAddress);
    }

    // ─── Minting ────────────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _checkVerified(to);
        _mint(to, amount);
    }

    // ─── Transfer hook — runs on every mint, burn, transfer ─────────────────

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        // Minting (from == address(0)) skips identity check on sender
        if (from != address(0) && address(_identityVerifier) != address(0)) {
            _checkVerified(from);
        }
        // Always check receiver if verifier is set (except burns)
        if (to != address(0) && address(_identityVerifier) != address(0)) {
            _checkVerified(to);
        }
        super._update(from, to, amount);
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
        override(AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
