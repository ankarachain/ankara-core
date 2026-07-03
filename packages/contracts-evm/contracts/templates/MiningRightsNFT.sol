// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraNFTBase.sol";

/**
 * @title MiningRightsNFT
 * @author Cranebolt Technologies
 * @notice Ankara Chain NFT template — unique on-chain mining license deed.
 *
 * Each token = one mining license / concession area.
 * Tracks license expiry and renewal on-chain; integrates with national mining registries.
 *
 * Use cases: license lifecycle management, royalty tracking,
 * DeFi collateral for mining operations, investor transparency.
 */
contract MiningRightsNFT is AnkaraNFTBase {

    struct MiningRightsNFTMetadata {
        string  licenseNumber;      // Issuing authority license number
        string  mineralType;        // gold | copper | coal | lithium | tin | etc.
        string  concessionArea;     // Named concession or block reference
        uint256 areaHectares;       // Concession area in hectares
        uint256 licenseExpiry;      // Unix timestamp of license expiry
        string  issuingAuthority;   // Government body that issued the license
        bytes32 licenseDocumentHash;// IPFS CID of license document
        uint256 royaltyRateBps;     // Royalty rate in basis points
        uint256 lastUpdated;        // Unix timestamp of last update
    }

    mapping(uint256 => MiningRightsNFTMetadata) private _tokenMetadata;
    mapping(uint256 => uint256) public metadataVersion;

    event MiningRightsNFTMinted(uint256 indexed tokenId, address indexed to, bytes32 assetId);
    event MetadataUpdated(uint256 indexed tokenId, uint256 version, uint256 timestamp);
    event LicenseRenewed(
        uint256 indexed tokenId,
        uint256 oldExpiry,
        uint256 newExpiry
    );

    uint256[50] private __gap;

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_
    ) external initializer {
        __AnkaraNFTBase_init(name_, symbol_, assetId_, countryCode_, admin_, verifier_);
    }

    // ─── Minting ────────────────────────────────────────────────────────────

    function mint(address to, MiningRightsNFTMetadata memory meta)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _mintNext(to);
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        metadataVersion[tokenId] = 1;
        emit MiningRightsNFTMinted(tokenId, to, this.assetId());
        emit MetadataUpdated(tokenId, 1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata(uint256 tokenId)
        external
        view
        returns (MiningRightsNFTMetadata memory)
    {
        return _tokenMetadata[tokenId];
    }

    function isLicenseExpired(uint256 tokenId) external view returns (bool) {
        return block.timestamp > _tokenMetadata[tokenId].licenseExpiry;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(uint256 tokenId, MiningRightsNFTMetadata memory meta)
        external
        onlyRole(MANAGER_ROLE)
    {
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        uint256 version = ++metadataVersion[tokenId];
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }

    function renewLicense(uint256 tokenId, uint256 newExpiry)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 old = _tokenMetadata[tokenId].licenseExpiry;
        _tokenMetadata[tokenId].licenseExpiry = newExpiry;
        _tokenMetadata[tokenId].lastUpdated = block.timestamp;
        uint256 version = ++metadataVersion[tokenId];
        emit LicenseRenewed(tokenId, old, newExpiry);
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }
}
