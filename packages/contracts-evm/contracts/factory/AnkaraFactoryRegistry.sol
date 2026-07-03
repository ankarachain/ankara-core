// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./TokenFactory.sol";
import "./NFTFactory.sol";
import "./MultiTokenFactory.sol";
import "./EscrowFactory.sol";

/**
 * @title AnkaraFactoryRegistry
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Unified top-level registry pointing to all four Ankara Chain sub-factories.
 *
 * Acts as the single entry point for:
 * - Discovering which factories are deployed
 * - Querying all tokens deployed by a given address across all standards
 * - Verifying whether an address is an Ankara-deployed contract
 *
 * Sub-factories registered:
 * - ERC20       → TokenFactory (6 ERC-20 RWA templates)
 * - NFT         → NFTFactory (4 ERC-721 asset record templates)
 * - MULTI_TOKEN → MultiTokenFactory (ERC-1155 + PoolVault)
 * - ESCROW      → EscrowFactory (MilestoneEscrow)
 */
contract AnkaraFactoryRegistry is Ownable {

    // ─── Factory type enum ──────────────────────────────────────────────────
    enum FactoryType { ERC20, NFT, MULTI_TOKEN, ESCROW }

    // ─── State ──────────────────────────────────────────────────────────────
    mapping(FactoryType => address) private _factories;

    // ─── Events ─────────────────────────────────────────────────────────────
    event FactorySet(FactoryType indexed factoryType, address indexed factory);

    // ─── Errors ─────────────────────────────────────────────────────────────
    error ZeroAddress();

    // ─── Constructor ────────────────────────────────────────────────────────

    /**
     * @param initialOwner Address that can set factory pointers.
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─── Admin ──────────────────────────────────────────────────────────────

    /**
     * @notice Register or update a sub-factory address.
     * @dev onlyOwner. Pass address(0) to clear a factory entry.
     */
    function setFactory(FactoryType factoryType, address factory) external onlyOwner {
        _factories[factoryType] = factory;
        emit FactorySet(factoryType, factory);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /// @notice Returns the registered address for a given factory type.
    function getFactory(FactoryType factoryType) external view returns (address) {
        return _factories[factoryType];
    }

    /**
     * @notice Returns all contracts deployed by `deployer` across all four factories.
     * @dev Concatenates results from ERC20 + NFT + MultiToken + Escrow factories.
     *      Returns an empty array for any factory that is not yet registered.
     */
    function getAllDeployedByAddress(address deployer)
        external
        view
        returns (address[] memory result)
    {
        address erc20Factory      = _factories[FactoryType.ERC20];
        address nftFactory        = _factories[FactoryType.NFT];
        address multiTokenFactory = _factories[FactoryType.MULTI_TOKEN];
        address escrowFactory     = _factories[FactoryType.ESCROW];

        address[] memory erc20Tokens = erc20Factory != address(0)
            ? TokenFactory(erc20Factory).getDeployerTokens(deployer)
            : new address[](0);

        address[] memory nftTokens = nftFactory != address(0)
            ? NFTFactory(nftFactory).getDeployerNFTs(deployer)
            : new address[](0);

        address[] memory multiTokens = multiTokenFactory != address(0)
            ? MultiTokenFactory(multiTokenFactory).getDeployerMultiTokens(deployer)
            : new address[](0);

        address[] memory escrows = escrowFactory != address(0)
            ? EscrowFactory(escrowFactory).getDeployerEscrows(deployer)
            : new address[](0);

        uint256 total = erc20Tokens.length + nftTokens.length + multiTokens.length + escrows.length;
        result = new address[](total);

        uint256 idx;
        for (uint256 i = 0; i < erc20Tokens.length; i++)  result[idx++] = erc20Tokens[i];
        for (uint256 i = 0; i < nftTokens.length; i++)    result[idx++] = nftTokens[i];
        for (uint256 i = 0; i < multiTokens.length; i++)  result[idx++] = multiTokens[i];
        for (uint256 i = 0; i < escrows.length; i++)      result[idx++] = escrows[i];
    }

    /**
     * @notice Returns true if `tokenAddress` was deployed by any registered Ankara factory.
     * @dev O(n) across all deployed contracts — intended for view calls only.
     */
    function isAnkaraToken(address tokenAddress) external view returns (bool) {
        // Check ERC-20 factory
        address erc20Factory = _factories[FactoryType.ERC20];
        if (erc20Factory != address(0)) {
            TokenFactory tf = TokenFactory(erc20Factory);
            uint256 count = tf.totalDeployed();
            for (uint256 i = 0; i < count; i++) {
                if (tf.allDeployedTokens(i) == tokenAddress) return true;
            }
        }

        // Check NFT factory
        address nftFactory = _factories[FactoryType.NFT];
        if (nftFactory != address(0)) {
            NFTFactory nf = NFTFactory(nftFactory);
            uint256 count = nf.totalDeployedNFTs();
            for (uint256 i = 0; i < count; i++) {
                if (nf.allDeployedNFTs(i) == tokenAddress) return true;
            }
        }

        // Check MultiToken factory
        address multiFactory = _factories[FactoryType.MULTI_TOKEN];
        if (multiFactory != address(0)) {
            MultiTokenFactory mf = MultiTokenFactory(multiFactory);
            uint256 count = mf.totalDeployedMultiTokens();
            for (uint256 i = 0; i < count; i++) {
                if (mf.allDeployedMultiTokens(i) == tokenAddress) return true;
            }
        }

        // Check Escrow factory
        address escrowFactory = _factories[FactoryType.ESCROW];
        if (escrowFactory != address(0)) {
            EscrowFactory ef = EscrowFactory(escrowFactory);
            uint256 count = ef.totalDeployedEscrows();
            for (uint256 i = 0; i < count; i++) {
                if (ef.allDeployedEscrows(i) == tokenAddress) return true;
            }
        }

        return false;
    }
}
