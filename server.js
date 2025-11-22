require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

mongoose.connect(process.env.MONGO_URI);

const faucetSchema = new mongoose.Schema({
    ip: String,
    time: Number
});
const FaucetRequests = mongoose.model("FaucetRequest", faucetSchema);

const prizes = [
    { amount: 0.01, weight: 20 },
    { amount: 0.02, weight: 20 },
    { amount: 0.05, weight: 10 },
    { amount: 0.1, weight: 10 },
    { amount: 0.2, weight: 10 },
    { amount: 0.5, weight: 5 },
    { amount: 1, weight: 5 },
];

function getRandomPrize(prizes) {
    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    for (let prize of prizes) {
        if (random < prize.weight) return prize.amount;
        random -= prize.weight;
    }
}

const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
const faucetWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(
    process.env.TOKEN_ADDRESS,
    ["function transfer(address to, uint256 amount) public returns (bool)"],
    faucetWallet
);

app.post("/faucet", async (req, res) => {
    const ip = req.ip;
    const userWalletAddress = req.body.wallet;

    console.log("Faucet request from", ip);

    if (!ethers.isAddress(userWalletAddress)) {
        console.log("Invalid wallet address");
        return res.status(400).json({ error: "Invalid wallet address" });
    }

    const lastRequest = await FaucetRequests.findOne({ ip });
    const cooldown = 24 * 60 * 60 * 1000; 
    const now = Date.now();

    if (lastRequest && now - lastRequest.time < cooldown && userWalletAddress != process.env.MY_ADDRESS) {
        const remaining = cooldown - (now - lastRequest.time);

        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

        return res.status(429).json({
            error: `Please wait ${hours}h ${minutes}m ${seconds}s before claiming again.`,
            hours,
            minutes,
            seconds
        });
    }

    const prizeAmount = getRandomPrize(prizes);
    const adjustedPrizeAmount = prizeAmount * 100 / 90;  // adjust for 10% sender tax

    try {
        const tx = await tokenContract.transfer(userWalletAddress, ethers.parseUnits(adjustedPrizeAmount.toString(), parseInt(process.env.DECIMALS)));
        await FaucetRequests.updateOne(
            { ip },
            { ip, time: Date.now() },
            { upsert: true }
        );

        res.json({ amount: prizeAmount, txHash: tx.hash });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Transaction failed" });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Faucet server running on port ${process.env.PORT}`);
});