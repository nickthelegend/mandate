// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title USDCx
 * @notice A six-decimal test token implementing EIP-3009, so x402's `exact`
 *         scheme has something real to settle against on Sepolia.
 *
 * @dev x402's `exact` scheme is built on `transferWithAuthorization`: the payer
 *      signs an EIP-712 authorisation off chain and hands it over in a header,
 *      and a facilitator submits it. The payer never broadcasts a transaction
 *      and never spends gas.
 *
 *      The existing TestUSDC is a plain ERC-20, so demonstrating x402 against
 *      it would mean inventing a scheme -- and a payment-protocol demo that
 *      quietly redefines the protocol has demonstrated nothing.
 *
 *      The EIP-712 machinery is written out here rather than imported from
 *      OpenZeppelin, which is how circle's own EIP-3009 does it. OZ 5.6's
 *      EIP712 reaches Math and then Bytes.sol, which uses `mcopy` and needs
 *      Cancun; raising evmVersion for the whole project would change the
 *      already-deployed escrow's bytecode and make that address unverifiable
 *      against this source. Twenty lines of hashing is the cheaper trade.
 *
 *      Note what EIP-3009 does *not* give you, which is the entire reason this
 *      repository exists: a facilitator submits the authorisation and then
 *      reports back whether it worked, and the resource server is expected to
 *      believe it. Nothing in the protocol checks that the transaction the
 *      facilitator names actually moved the money.
 */
contract USDCx is ERC20 {
    /// @dev keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 private constant DOMAIN_TYPEHASH =
        0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;

    /// @dev keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    /// @dev Cached against the deploy-time chain id, and recomputed if it ever
    ///      differs -- a fork would otherwise let signatures replay across chains.
    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;

    /// @notice Authorisation state, per payer, per nonce. Single-use by design.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationNotYetValid(uint256 validAfter);
    error AuthorizationExpired(uint256 validBefore);
    error AuthorizationAlreadyUsed(bytes32 nonce);
    error InvalidSignature(address recovered, address expected);
    error CallerNotPayee(address caller, address payee);
    error MalformedSignature(uint256 length);

    constructor() ERC20("USD Coin (x402 test)", "USDCx") {
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet. This is a testnet token; gating it helps nobody.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    /**
     * @notice Execute a transfer the payer authorised off chain.
     * @dev Anyone may submit it. That is the point of the scheme -- the payer
     *      signs, a facilitator pays the gas, and the value moves without the
     *      payer ever broadcasting a transaction.
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _requireValidAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice The same, but only the payee may submit it.
     * @dev EIP-3009 includes this because a bare `transferWithAuthorization` is
     *      front-runnable: a signed authorisation sitting in the mempool can be
     *      submitted by anyone, and while the value still lands where it should,
     *      the submitter chooses when. Requiring `msg.sender == to` closes it.
     */
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        if (msg.sender != to) revert CallerNotPayee(msg.sender, to);
        _requireValidAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("USD Coin (x402 test)")),
                    keccak256(bytes("2")),
                    block.chainid,
                    address(this)
                )
            );
    }

    function _requireValidAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) private view {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid(validAfter);
        if (block.timestamp >= validBefore) revert AuthorizationExpired(validBefore);
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed(nonce);

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));

        address signer = _recover(digest, signature);
        if (signer != from) revert InvalidSignature(signer, from);
    }

    /**
     * @dev ecrecover with the two guards it does not apply itself: high-s
     *      signatures are rejected because every ECDSA signature has a second
     *      equally valid form, and a contract that accepts both accepts two
     *      distinct byte strings for one authorisation; and address(0) is
     *      rejected because that is what ecrecover returns on failure, which
     *      would otherwise compare equal to an uninitialised `from`.
     */
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert MalformedSignature(signature.length);

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;

        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature(address(0), address(0));
        }

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature(address(0), address(0));
        return signer;
    }

    function _markAuthorizationUsed(address from, bytes32 nonce) private {
        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }
}
