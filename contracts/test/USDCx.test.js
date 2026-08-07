const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * EIP-3009 is the rail x402's `exact` scheme rides on, which means every bug in
 * here is a way to move somebody else's money. These are written against the
 * signature failures specifically -- replay, expiry, wrong signer, malleability
 * -- because the happy path is the one case that cannot lose funds.
 */
describe("USDCx (EIP-3009)", () => {
  const VALUE = 1_000_000n; // 1.00 at six decimals

  let token, addr, payer, payee, facilitator, outsider, domain;

  const TYPES = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  /** An authorisation valid right now, signed by `signer`. */
  async function authorize(signer, overrides = {}) {
    const now = await time.latest();
    const auth = {
      from: payer.address,
      to: payee.address,
      value: VALUE,
      validAfter: 0,
      validBefore: now + 3600,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      ...overrides,
    };
    return { auth, signature: await signer.signTypedData(domain, TYPES, auth) };
  }

  const submit = (c, { auth, signature }) =>
    c.transferWithAuthorization(
      auth.from,
      auth.to,
      auth.value,
      auth.validAfter,
      auth.validBefore,
      auth.nonce,
      signature
    );

  beforeEach(async () => {
    [, payer, payee, facilitator, outsider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("USDCx");
    token = await Token.deploy();
    addr = await token.getAddress();
    await token.mint(payer.address, VALUE * 100n);

    domain = {
      name: "USD Coin (x402 test)",
      version: "2",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: addr,
    };
  });

  it("agrees with ethers on the domain separator", async () => {
    // If these disagree, every signature a client produces is unverifiable and
    // the failure looks like "wrong signer" rather than "wrong domain".
    expect(await token.DOMAIN_SEPARATOR()).to.equal(
      ethers.TypedDataEncoder.hashDomain(domain)
    );
  });

  it("moves value on an authorisation the payer never broadcast", async () => {
    // The whole point of the scheme: the facilitator pays the gas, the payer
    // only ever signed.
    const signed = await authorize(payer);
    await expect(submit(token.connect(facilitator), signed)).to.changeTokenBalances(
      token,
      [payer, payee],
      [-VALUE, VALUE]
    );
  });

  it("refuses to replay a used authorisation", async () => {
    /*
     * The failure that turns a signed payment into a standing withdrawal. An
     * authorisation is a bearer instrument -- once it is in a header it is in
     * logs, proxies, and somebody's terminal history.
     */
    const signed = await authorize(payer);
    await submit(token.connect(facilitator), signed);

    await expect(submit(token.connect(facilitator), signed)).to.be.revertedWithCustomError(
      token,
      "AuthorizationAlreadyUsed"
    );
    expect(await token.authorizationState(payer.address, signed.auth.nonce)).to.equal(true);
  });

  it("refuses an authorisation that has expired or has not started", async () => {
    const now = await time.latest();

    const expired = await authorize(payer, { validBefore: now + 60 });
    await time.increase(120);
    await expect(submit(token.connect(facilitator), expired)).to.be.revertedWithCustomError(
      token,
      "AuthorizationExpired"
    );

    const future = await authorize(payer, { validAfter: (await time.latest()) + 3600 });
    await expect(submit(token.connect(facilitator), future)).to.be.revertedWithCustomError(
      token,
      "AuthorizationNotYetValid"
    );
  });

  it("refuses a signature from anyone but the payer", async () => {
    // Signed by an outsider, but claiming `from` is the payer.
    const signed = await authorize(outsider);
    await expect(submit(token.connect(facilitator), signed)).to.be.revertedWithCustomError(
      token,
      "InvalidSignature"
    );
  });

  it("refuses an authorisation whose fields were altered after signing", async () => {
    const signed = await authorize(payer);
    signed.auth.value = VALUE * 10n; // the facilitator helps itself
    await expect(submit(token.connect(facilitator), signed)).to.be.revertedWithCustomError(
      token,
      "InvalidSignature"
    );
  });

  it("rejects the malleable twin of a valid signature", async () => {
    /*
     * Every ECDSA signature has a second equally valid form with s replaced by
     * n - s. Without the high-s guard both verify, so one authorisation has two
     * distinct byte encodings -- and any system deduplicating by signature
     * bytes rather than by nonce would see them as different payments.
     */
    const { auth, signature } = await authorize(payer);
    const sig = ethers.Signature.from(signature);
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

    const malleable = ethers.concat([
      sig.r,
      ethers.toBeHex(N - BigInt(sig.s), 32),
      ethers.toBeHex(sig.v === 27 ? 28 : 27, 1),
    ]);

    await expect(
      submit(token.connect(facilitator), { auth, signature: malleable })
    ).to.be.revertedWithCustomError(token, "InvalidSignature");
  });

  it("rejects a signature of the wrong length instead of reading past it", async () => {
    const { auth, signature } = await authorize(payer);
    await expect(
      submit(token.connect(facilitator), { auth, signature: signature.slice(0, 100) })
    ).to.be.revertedWithCustomError(token, "MalformedSignature");
  });

  describe("receiveWithAuthorization", () => {
    const receive = (c, { auth, signature }) =>
      c.receiveWithAuthorization(
        auth.from,
        auth.to,
        auth.value,
        auth.validAfter,
        auth.validBefore,
        auth.nonce,
        signature
      );

    it("lets the payee pull, and nobody else", async () => {
      const signed = await authorize(payer);

      await expect(receive(token.connect(facilitator), signed)).to.be.revertedWithCustomError(
        token,
        "CallerNotPayee"
      );

      await expect(receive(token.connect(payee), signed)).to.changeTokenBalances(
        token,
        [payer, payee],
        [-VALUE, VALUE]
      );
    });
  });
});
