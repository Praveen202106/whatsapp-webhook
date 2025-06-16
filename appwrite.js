// lib/appwriteClient.js
const { Client, Databases, Account, Storage } = require("node-appwrite");

const client = new Client();

client
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT)
  .setKey(process.env.NEXT_APPWRITE_KEY);

// Export initialized clients
const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

module.exports = { client, account, databases, storage };
