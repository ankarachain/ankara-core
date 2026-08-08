// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IIdentityVerifier.sol";
import "../interfaces/IAnkaraMultiToken.sol";

/**
 * @title AnkaraMultiToken
 * @author PIE Drops Studio
 * @notice Abstract base inherited by all Ankara Chain ERC-1155 multi-token contracts.
 *
 * Provides:
 * - ERC-1155 with mint, mintBatch, burn, burnBatch, pause
 * - Role-based access control (MINTER, PAUSER, UPGRADER, MANAGER)
 * - Per-token-ID identity verifier hooks (optional — address(0) = open for that ID)
 * - Token ID registration with metadata and status tracking
 * - UUPS upgradeable proxy
 *
 * Key difference from ERC-20/ERC-721 bases: identity verification is per-token-ID.
 * Each ID registered in the contract can have its own IIdentityVerifier.
 *
 * Deploy via MultiTokenFactory only. Never deploy this directly.
 */
abstract contract AnkaraMultiToken is
    Initializable,
    ERC1155Upgradeable,
    ERC1155PausableUpgradeable,
    ERC1155BurnableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IAnkaraMultiToken
{
    // ─── Roles ─────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");

    // ─── State ─────────────────────────────────────────────────────────────

    // Token ID registry — internal so derived templates can access
    mapping(uint256 => TokenDefinition) internal _tokenDefs;
    mapping(uint256 => bool)            internal _registered;

    // Per-token-ID identity verifiers (optional; address(0) = open transfers for that ID)
    mapping(uint256 => IIdentityVerifier) internal _tokenVerifiers;

    // Manual per-ID supply tracking — internal so templates can update on merge
    mapping(uint256 => uint256) internal _idTotalSupply;

    // Contract-level metadata
    string private _contractName;
    string private _contractCountryCode;

    // ─── Storage gap ───────────────────────────────────────────────────────
    uint256[50] private __gap;

    // ─── Errors ────────────────────────────────────────────────────────────
    error NotVerified(address account);
    error TokenIdAlreadyRegistered(uint256 id);
    error TokenIdNotRegistered(uint256 id);
    error MaxSupplyExceeded(uint256 id, uint256 requested, uint256 available);

    // ─── Initializer ───────────────────────────────────────────────────────

    function __AnkaraMultiToken_init(
        string memory name_,
        string memory countryCode_,
        string memory baseURI_,
        address admin_
    ) internal onlyInitializing {
        __ERC1155_init(baseURI_);
        __ERC1155Pausable_init();
        __ERC1155Burnable_init();
        __AccessControl_init();
        _contractName        = name_;
        _contractCountryCode = countryCode_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE,        admin_);
        _grantRole(PAUSER_ROLE,        admin_);
        _grantRole(UPGRADER_ROLE,      admin_);
        _grantRole(MANAGER_ROLE,       admin_);
    }

    // ─── IAnkaraMultiToken ─────────────────────────────────────────────────

    /**
     * @notice Register a new token ID with its definition.
     * @dev Must be called before any minting for this ID.
     */
    function registerTokenId(uint256 id, TokenDefinition calldata def)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        _registerTokenId(id, def);
    }

    function _registerTokenId(uint256 id, TokenDefinition memory def) internal {
        if (_registered[id]) revert TokenIdAlreadyRegistered(id);
        _registered[id]  = true;
        _tokenDefs[id]   = def;
        emit TokenIdRegistered(id, def.isFungible, def.name);
    }

    /**
     * @notice Set (or replace) the identity verifier for a specific token ID.
     * @dev address(0) removes the verifier, making transfers open for that ID.
     */
    function setTokenVerifier(uint256 id, address verifier)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        address old = address(_tokenVerifiers[id]);
        _tokenVerifiers[id] = IIdentityVerifier(verifier);
        emit TokenVerifierUpdated(id, old, verifier);
    }

    function getTokenDefinition(uint256 id)
        external
        view
        override
        returns (TokenDefinition memory)
    {
        return _tokenDefs[id];
    }

    /**
     * @notice Update the lifecycle status of a registered token ID.
     * @dev MANAGER_ROLE. Emits TokenStatusChanged.
     */
    function setAssetStatus(uint256 id, AssetStatus newStatus)
        external
        override
        onlyRole(MANAGER_ROLE)
    {
        _setAssetStatus(id, newStatus);
    }

    function _setAssetStatus(uint256 id, AssetStatus newStatus) internal {
        if (!_registered[id]) revert TokenIdNotRegistered(id);
        AssetStatus old = _tokenDefs[id].status;
        _tokenDefs[id].status = newStatus;
        emit TokenStatusChanged(id, old, newStatus, block.timestamp);
    }

    function isRegistered(uint256 id) external view override returns (bool) {
        return _registered[id];
    }

    function totalSupply(uint256 id) external view override returns (uint256) {
        return _idTotalSupply[id];
    }

    function pause() external override onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external override onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── Minting ───────────────────────────────────────────────────────────

    /**
     * @notice Mint `amount` of token `id` to `to`.
     * @dev Requires MINTER_ROLE. Token ID must be registered. Identity check if verifier set.
     */
    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) {
        _mintChecked(to, id, amount, data);
    }

    /**
     * @notice Batch mint multiple token IDs to `to`.
     * @dev All IDs must be registered. Identity check runs per ID.
     */
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) {
        for (uint256 i = 0; i < ids.length; i++) {
            _mintChecked(to, ids[i], amounts[i], data);
        }
    }

    function _mintChecked(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal {
        if (!_registered[id]) revert TokenIdNotRegistered(id);

        // Max supply check (0 = unlimited)
        uint256 max = _tokenDefs[id].maxSupply;
        if (max > 0 && _idTotalSupply[id] + amount > max) {
            revert MaxSupplyExceeded(id, amount, max - _idTotalSupply[id]);
        }

        _idTotalSupply[id] += amount;
        _mint(to, id, amount, data);
    }

    // ─── Burning ───────────────────────────────────────────────────────────
    // Inherited burn/burnBatch from ERC1155BurnableUpgradeable (holder-controlled)
    // Override to update _idTotalSupply

    function burn(address account, uint256 id, uint256 value) public virtual override {
        super.burn(account, id, value);
        _idTotalSupply[id] -= value;
    }

    function burnBatch(
        address account,
        uint256[] memory ids,
        uint256[] memory values
    ) public virtual override {
        super.burnBatch(account, ids, values);
        for (uint256 i = 0; i < ids.length; i++) {
            _idTotalSupply[ids[i]] -= values[i];
        }
    }

    // ─── URI override ───────────────────────────────────────────────────────

    /**
     * @notice Returns IPFS metadata URI for a token ID if set, else falls back to base URI.
     */
    function uri(uint256 id)
        public
        view
        virtual
        override(ERC1155Upgradeable)
        returns (string memory)
    {
        string memory tokenURI = _tokenDefs[id].metadataURI;
        if (bytes(tokenURI).length > 0) {
            return tokenURI;
        }
        return super.uri(id);
    }

    // ─── Contract metadata ──────────────────────────────────────────────────

    function contractName() external view returns (string memory) {
        return _contractName;
    }

    function contractCountryCode() external view returns (string memory) {
        return _contractCountryCode;
    }

    // ─── Transfer hook — identity check per token ID ────────────────────────
    // OZ v5 ERC-1155 uses _update(from, to, ids[], values[]) — no data param.

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override(ERC1155Upgradeable, ERC1155PausableUpgradeable) {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            IIdentityVerifier verifier = _tokenVerifiers[id];
            if (address(verifier) != address(0)) {
                // Skip sender check when minting (from == address(0))
                if (from != address(0) && !verifier.isVerified(from)) {
                    revert NotVerified(from);
                }
                // Skip receiver check when burning (to == address(0))
                if (to != address(0) && !verifier.isVerified(to)) {
                    revert NotVerified(to);
                }
            }
        }
        super._update(from, to, ids, values);
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
        override(ERC1155Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
