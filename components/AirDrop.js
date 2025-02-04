import 'dotenv/config'
import { useState, useEffect } from "react";
import axios from "axios";
import { verifyMessage } from "ethers/lib/utils";
import { useAccount, useSignMessage } from "wagmi";
import styles from "@/styles/AirDrop.module.css";
import { Keyring } from '@polkadot/api';
import { ApiPromise, WsProvider } from '@polkadot/api';
import {
  blake2AsU8a,
  decodeAddress,
  encodeAddress,
} from "@polkadot/util-crypto";
import {
  hexToU8a,
  isHex,
  stringToU8a,
  u8aConcat,
} from "@polkadot/util";
import { isAddress } from 'web3-validator';
import validator from 'validator'

export default function AirDrop() {
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const { address } = useAccount({
    onDisconnect() {
      reset();
    },
    
  });

  useEffect(() => {
    reset();
    // Query the airdrop_addresses table to check if this user is already in the aidrop list.
    // If they are there is no need to connect to the scorer API, we can display their passport score immediately.
    async function checkIfAddressAlreadyInAirdropList() {
      const resp = await axios.post(`/api/airdrop/check/${address}`);
      if (resp?.data?.address) {
        setChecked(true);
        setPassportScore(resp.data.score);
      }
    }
    checkIfAddressAlreadyInAirdropList();
  }, [address]);

  function isValidAddressPolkadotAddress(address) {
    try {
      encodeAddress(
        isHex(address)
          ? hexToU8a(address)
          : decodeAddress(address)
      );
  
      return true;
    } catch (error) {
      return false;
    }
  }

  async function sendToken() {
    if (input === "") {
      return
    }

    if (!isAddress(input) && !isValidAddressPolkadotAddress(input)) {
      alert("address is not a isValid Address");
      return;
    }

    setNonce("");
    setPassportScore(0);
    //  Step #1 (Optional, only required if using the "signature" param when submitting a user's passport. See https://docs.passport.gitcoin.co/building-with-passport/scorer-api/endpoint-definition#submit-passport)
    //    We call our /api/scorer-message endpoint (/pages/api/scorer-message.js) which internally calls /registry/signing-message
    //    on the scorer API. Instead of calling /registry/signing-message directly, we call it via our api endpoint so we do not
    //    expose our scorer API key to the frontend.
    //    This will return a response like:
    //    {
    //      message: "I hereby agree to submit my address in order to score my associated Gitcoin Passport from Ceramic.",
    //      nonce: "b7e3b0f86820744b9242dd99ce91465f10c961d98aa9b3f417f966186551"
    //    }
    const scorerMessageResponse = await axios.get("/api/scorer-message");
    if (scorerMessageResponse.status !== 200) {
      console.error("failed to fetch scorer message");
      return;
    }
    setNonce(scorerMessageResponse.data.nonce);

    //  Step #2 (Optional, only required if using the "signature" param when submitting a user's passport.)
    //    Have the user sign the message that was returned from the scorer api in Step #1.
    signMessage({ message: scorerMessageResponse.data.message });
  }

  const { signMessage } = useSignMessage({
    async onSuccess(data, variables) {
      // Verify signature when sign message succeeds
      const address = verifyMessage(variables.message, data);

      //  Step #3
      //    Now that we have the signature from the user, we can submit their passport for scoring
      //    We call our /api/submit-passport endpoint (/pages/api/submit-passport.js) which
      //    internally calls /registry/submit-passport on the scorer API.
      //    This will return a response like:
      //    {
      //      address: "0xabc",
      //      error: null,
      //      evidence: null,
      //      last_score_timestamp: "2023-03-26T15:17:03.393567+00:00",
      //      score: null,
      //      status: "PROCESSING"
      //    }
      const submitResponse = await axios.post("/api/submit-passport", {
        address: address, // Required: The user's address you'd like to score.
        community: process.env.NEXT_PUBLIC_SCORER_ID, // Required: get this from one of your scorers in the Scorer API dashboard https://scorer.gitcoin.co/
        signature: data, // Optional: The signature of the message returned in Step #1
        nonce: nonce, // Optional: The nonce returned in Step #1
      });

      //  Step #4
      //    Finally, we can attempt to add the user to the airdrop list.
      //    We call our /api/airdrop/{scorer_id}/{address} endpoint (/pages/api/airdrop/[scorer_id]/[address].js) which internally calls
      //    /registry/score/{scorer_id}/{address}
      //    This will return a response like:
      //    {
      //      address: "0xabc",
      //      error: null,
      //      evidence: null,
      //      last_score_timestamp: "2023-03-26T15:17:03.393567+00:00",
      //      score: "1.574606692",
      //      status: ""DONE""
      //    }
      //    We check if the returned score is above our threshold to qualify for the airdrop.
      //    If the score is above our threshold, we add the user to the airdrop list.
      const scoreResponse = await axios.get(
        `/api/airdrop/add/${process.env.NEXT_PUBLIC_SCORER_ID}/${address}`
      );

      // Make sure to check the status
      if (scoreResponse.data.status === "ERROR") {
        setPassportScore(0);
        alert(scoreResponse.data.error);
        return;
      }

      // Store the user's passport score for later use.
      setPassportScore(scoreResponse.data.score);
      setChecked(true);

      if (scoreResponse.data.score < 1) {
        alert("Sorry, your score not enough for the faucet. go to https://passport.gitcoin.co to increase your score.");
      } else {
        // Construct
        const wsProvider = new WsProvider(process.env.NEXT_PUBLIC_GGX_WS_URL);
        const api = await ApiPromise.create({ provider: wsProvider });

        // Create a keyring instance
        const keyring = new Keyring({ type: 'sr25519' });

        // Create alice (carry-over from the keyring section)
        const faucetAccount = keyring.addFromUri(process.env.NEXT_PUBLIC_MNEMONIC);
        let receive = input;
        const amount = process.env.NEXT_PUBLIC_FAUCET_AMOUNT;

        const chainInfo = await api.registry.getChainProperties()

        if (isAddress(input)) //todo check if evm address
        {
          //todo evm support convert,   substrate address
          const addr = hexToU8a(input);
          const data = stringToU8a("evm:");
          const res = blake2AsU8a(u8aConcat(data, addr));
          const prefix = chainInfo.ss58Format;
          const output = encodeAddress(res, prefix);

          receive = output;

          console.log("new address", receive);
        } else {
          if(!isValidAddressPolkadotAddress(input)) {
            console.log("address is not a isValid Polkadot Address");
            return;
          }
        }

        try {
          const resp = await axios.post("/api/faucet/check", { pass_port_address: address,  receive_address: receive, receive_amount: amount});
          if (resp.status === 200) {
  
          } else {
            console.log(`faucet check return error: ${resp.message}  ${resp.error}`);
            return;
          }
        } catch (e) {
          console.error(e);
          return;
        }

        const txHash = await api.tx.balances
          .transfer(receive, amount/*process.env.FAUCET_AMOUNT*/)
          .signAndSend(faucetAccount);

        // Show the hash
        console.log(`@@@Submitted with hash ${txHash}`);
        console.log("Your token has been sent.");
        setTxHash(txHash.toString());

        try {
          let datatime = new Date();
          const resp = await axios.post("/api/faucet/add", { pass_port_address: address,  receive_address: input, receive_time: datatime, receive_amount: amount});
          if (resp.status === 200) {
  
          } else {
            console.log(`faucet check return error: ${resp.message}  ${resp.error}`);
            return;
          }
        } catch (e) {
          console.error(e);
        }

      }
    },
  });

  function reset() {
    setNonce("");
    setPassportScore(0);
    setChecked(false);
  }

  // This isMounted check is needed to prevent hydration errors with next.js server side rendering.
  // See https://github.com/wagmi-dev/wagmi/issues/542 for more details.
  const [isMounted, setIsMounted] = useState(false);
  const [nonce, setNonce] = useState("");
  const [passportScore, setPassportScore] = useState(0);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState('');
  const [txHash, setTxHash] = useState('');

  const validate = (inputText) => { 
    setInput(validator.trim(inputText))
  }

  function display() {
    if (isMounted && address) {
          return (
            <div>
            <div>
            <input className={styles.input} placeholder="Your ggx address" value={input} onChange={(e) => validate(e.target.value)}></input>
            <button className={styles.btn} onClick={() => sendToken(address)}>
              get ggx
            </button>
            </div>
            <div>tx:  <a href={process.env.NEXT_PUBLIC_GGX_EXPLORER_URL}>{txHash}</a></div>
            </div>
          );
    } else {
      return (
        <p className={styles.p}>
          Connect your wallet to find out if you&apos;re eligible for the
          faucet.
        </p>
      );
    }
  }

  return <div>{display()}</div>;
}
