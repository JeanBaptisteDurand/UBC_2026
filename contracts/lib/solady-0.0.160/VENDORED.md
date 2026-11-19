# solady 0.0.160 (two files only)

`src/utils/LibString.sol` and `src/utils/Base64.sol`, copied unchanged (sha256 checked) from the solady copy inside
Automata's DCAP attestation repository (`evm/lib/automata-on-chain-pccs/lib/solady`, commit
`772a49d91b004eb55dc9129ae57dd36fbb8417ee`): the same version that is compiled into Automata's DCAP verifier deployed
on Arc. `PckChip` uses them to read the PCK certificate of a quote exactly as Automata reads it (PEM split, Base64
decoding). MIT license (solady, Vectorized): `LICENSE.txt`.
