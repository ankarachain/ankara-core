// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraNFTBase.sol";

/**
 * @title CommodityVaultNFT
 * @author PIE Drops Studio
 * @notice Ankara Chain NFT template — certified warehouse receipt as a unique NFT.
 *
 * Each token = one certified warehouse unit / lot held in a physical vault.
 * Unlike the ERC-20 CommodityReceiptToken (fungible fractional ownership),
 * each NFT represents a specific, uniquely identified physical lot.
 *
 * Use cases: warehouse receipt financing, commodity trading,
 * supply chain provenance, DeFi collateral for physical goods.
 */
contract CommodityVaultNFT is AnkaraNFTBase {

    struct CommodityVaultNFTMetadata {
        string  warehouseId;        // Unique warehouse identifier
        string  warehouseLocation;  // Physical location of warehouse
        address operatorAddress;    // Warehouse operator / custodian
        string  commodityType;      // cocoa | coffee | maize | gold | etc.
        uint256 quantityKg;         // Quantity in kilograms
        string  gradeClassification;// Grade / quality classification
        bytes32 certificateHash;    // IPFS CID of warehouse certificate
        uint256 depositDate;        // Unix timestamp of deposit
        uint256 lastUpdated;        // Unix timestamp of last update
    }

    mapping(uint256 => CommodityVaultNFTMetadata) private _tokenMetadata;
    mapping(uint256 => uint256) public metadataVersion;

    event CommodityVaultNFTMinted(uint256 indexed tokenId, address indexed to, bytes32 assetId);
    event MetadataUpdated(uint256 indexed tokenId, uint256 version, uint256 timestamp);

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

    function mint(address to, CommodityVaultNFTMetadata memory meta)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _mintNext(to);
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        metadataVersion[tokenId] = 1;
        emit CommodityVaultNFTMinted(tokenId, to, this.assetId());
        emit MetadataUpdated(tokenId, 1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata(uint256 tokenId)
        external
        view
        returns (CommodityVaultNFTMetadata memory)
    {
        return _tokenMetadata[tokenId];
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(uint256 tokenId, CommodityVaultNFTMetadata memory meta)
        external
        onlyRole(MANAGER_ROLE)
    {
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        uint256 version = ++metadataVersion[tokenId];
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }
}
