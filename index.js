const express = require("express");
const axios = require("axios");

const WHATSAPP_ACCESS_TOKEN =
  "EAANKuzEU6ekBOZBtfB1w22p9LcQVQFpYnzChuSPRsLTC4dZAchJ2ZBoPGamOWjLbn2KgudLdtJEqXkckdKZBl6qaey7KlxVVAKnrMDKcqSzmg0DBr9rUyCb95KaKZBVCNGoB47TumxZBP9Ojr8aLoWIARIUrFZAi1mBLZAhr1dxYFK7eC8eKsZCLVZADU2BxrbZAsdXbR6HZAA9lLZASQdTeMNhRJbGNZCBY26ZAhIlqEEl";
// const WHATSAPP_ACCESS_TOKEN =
//   "EAANKuzEU6ekBOz8fV8svENUPFQZCmw1TcWMRzVPtQtxoRjdvP0d47jrl4ToD4NGjQqN5ZBugnZBEcDQ6zvDT2aC6jdfSlpvkjtZBNh5fPnVgsWz44D1G7X01dGmNbE2ej23kkaM5OggdhVz392mdYkA2zgaZCXdxT603biyA8L56ttBJJ5OMK4BlcooUVYI65eutlt1DqMr56u5q1GAj663slHXKZAw8wZD";
const WEBHOOK_VERIFY_TOKEN = "my-verify-token";
const GUIDELINE_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjgyM2RkNDBhLWVhYjYtNDYyNC1hZDAxLTk3NjAyMDM2ZGM1ZiJ9.LAjtg_MgeRu4m92IV_gYGoAZVwec4xYdMD7z6aLQx_s"; // your LLM API KEY

const app = express();
app.use(express.json());

// Replace with your credentials

// In-memory context
const userState = {};

// Question Bank
const questions = {
  Q1: {
    question:
      "You’ve just automated a report that used to take you 5 hours weekly. What is the most effective way to reinforce a supportive digital culture?",
  },
};

// Random question picker
function getRandomQuestion() {
  const keys = Object.keys(questions);
  const randomKey = keys[Math.floor(Math.random() * keys.length)];
  return { id: randomKey, ...questions[randomKey] };
}

app.get("/", (req, res) => {
  console.log("Received GET request");
  res.send("Whatsapp with Node.js and Webhooks");
});

// Webhook verification (for Meta setup)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Main webhook route
app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];
  // console.log("entry:", JSON.stringify(entry, null, 2));
  // console.log("changes:", JSON.stringify(changes, null, 2));
  console.log("-----event received-----");
  console.log("message:", JSON.stringify(changes, null, 2));

  if (!message) return res.sendStatus(200); // No message found

  const from = message.from;
  const text = message.text?.body?.trim().toLowerCase();

  // First time user
  if (!userState[from]) {
    const q = getRandomQuestion();
    userState[from] = q;
    await sendMessage(from, `Welcome! Answer this question:\n\n${q.question}`);
    return res.sendStatus(200);
  }

  // Existing user answering
  const { question, answer } = userState[from];
  const userAnswer = message.text?.body.trim();

  const directPrompt = `Refer to the documents. Evaluate whether the user's submitted answer "${userAnswer}" to the question "${question}" aligns with the content in the document. 
          If the response does not align with any of the values provided in the document for that category, then set "finalVerdict" to "Wrong".
          Provide reasoning to support your evaluation and include relevant references from the document. Return the response in the following JSON format:
          [
            {
              "question": "${question}",
              "llmresponse": "Reason text here",
              "finalVerdict": "Correct or Wrong"
            }
          ]
          Start your response with [ and end it with ]`;

  const llmResult = await callLLM(directPrompt);

  if (!llmResult) {
    await sendMessage(from, "Sorry! I couldn't process your answer.");
    return res.sendStatus(200);
  }

  try {
    const llmJson = JSON.parse(llmResult);
    if (llmJson[0].finalVerdict === "Correct") {
      await sendMessage(
        from,
        `✅ Yes! That's correct.\n\nExplanation: ${llmJson[0].llmresponse}`
      );
    } else {
      await sendMessage(
        from,
        `❌ That's incorrect.\n\nExplanation: ${llmJson[0].llmresponse}`
      );
    }
  } catch (err) {
    console.error("Error parsing LLM response:", err);
    await sendMessage(from, "Something went wrong while evaluating.");
  }

  // Ask next question after every answer
  const nextQuestion = getRandomQuestion();
  userState[from] = nextQuestion;
  await sendMessage(from, `Next question:\n\n${nextQuestion.question}`);

  res.sendStatus(200);
});

// Call LLM using guideline API (your LLM server)
async function callLLM(prompt) {
  try {
    const response = await axios.post(
      "https://guideline.randomw.dev/api/chat/completions",
      {
        model: "chatgpt-4o-latest",
        messages: [{ role: "user", content: prompt }],
        files: [
          {
            type: "collection",
            // id: knowledgeBaseId,
            id: "37a7e86b-5c6c-415e-a00e-34516bef6ff3",
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${GUIDELINE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // console.log("LLM response:", response.data.choices[0].message);
    const llmText = response.data.choices[0].message.content;
    // Parse the string into a JavaScript object
    const parsed = JSON.parse(llmText);

    // Extract llmresponse and finalVerdict
    const llmResponseText = parsed[0].llmresponse;
    const finalVerdict = parsed[0].finalVerdict;

    // // Log values
    // console.log("LLM response:", llmResponseText);
    // console.log("Final Verdict:", finalVerdict);

    return llmText;
  } catch (error) {
    console.error("LLM call failed:", error.message);
    return null;
  }
}

// Send message to user via WhatsApp API
async function sendMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/665252706672275/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
}

// Start server
app.listen(8000, () => {
  console.log("WhatsApp bot listening on port 5000");
});

// const express = require('express')
// const axios = require('axios')

// const WHATSAPP_ACCESS_TOKEN = 'EAANKuzEU6ekBO4l5b7TLekUnUIXEC63F31ZAeuQ14ACN4YOeAjjWB25e7LfZAmJzPZBxAS6vS1xdsIWz8ahEPZCmDgWUYvpZCZBWnn831Jmhl1di1R0fTZBlzlJz5Q0cgHZC2u2AEDQ76hhJhUZBl5ZAXLhdDUAEqISD6vS32llpCmC4hzZCWD6anDgN9AqxwLEp6OOLnZCseZCgFsb2WnZAKsKvvv9dcUUnhHpNAZAH2AZD'
// const WEBHOOK_VERIFY_TOKEN = 'my-verify-token'

// const app = express()
// app.use(express.json())

// app.get('/', (req, res) => {
//   console.log('Received GET request')
//   res.send('Whatsapp with Node.js and Webhooks')
// })

// app.get('/webhook', (req, res) => {
//   const mode = req.query['hub.mode']
//   const challenge = req.query['hub.challenge']
//   const token = req.query['hub.verify_token']
//   console.log(`Webhook verification request praveen: mode=${mode}, token=${token}`)

//   if (mode && token === WEBHOOK_VERIFY_TOKEN) {
//     res.status(200).send(challenge)
//   } else {
//     res.sendStatus(403)
//   }
// })

// app.post('/webhook', async (req, res) => {
//   const { entry } = req.body
//   console.log('Received webhook event:', JSON.stringify(req.body, null, 2))

//   if (!entry || entry.length === 0) {
//     return res.status(400).send('Invalid Request')
//   }

//   const changes = entry[0].changes

//   if (!changes || changes.length === 0) {
//     return res.status(400).send('Invalid Request')
//   }

//   const statuses = changes[0].value.statuses ? changes[0].value.statuses[0] : null
//   const messages = changes[0].value.messages ? changes[0].value.messages[0] : null

//   if (statuses) {
//     // Handle message status
//     console.log(`
//       MESSAGE STATUS UPDATE:
//       ID: ${statuses.id},
//       STATUS: ${statuses.status}
//     `)
//   }

//   if (messages) {
//     // Handle received messages
//     if (messages.type === 'text') {
//       if (messages.text.body.toLowerCase() === 'hello') {
//         replyMessage(messages.from, 'Hello. How are you?', messages.id)
//       }

//       if (messages.text.body.toLowerCase() === 'list') {
//         sendList(messages.from)
//       }

//       if (messages.text.body.toLowerCase() === 'buttons') {
//         sendReplyButtons(messages.from)
//       }
//     }

//     if (messages.type === 'interactive') {
//       if (messages.interactive.type === 'list_reply') {
//         sendMessage(messages.from, `You selected the option with ID ${messages.interactive.list_reply.id} - Title ${messages.interactive.list_reply.title}`)
//       }

//       if (messages.interactive.type === 'button_reply') {
//         sendMessage(messages.from, `You selected the button with ID ${messages.interactive.button_reply.id} - Title ${messages.interactive.button_reply.title}`)
//       }
//     }

//     console.log(JSON.stringify(messages, null, 2))
//   }

//   res.status(200).send('Webhook processed')
// })

// async function sendMessage(to, body) {
//   await axios({
//     url: 'https://graph.facebook.com/v23.0/665252706672275/messages',
//     method: 'post',
//     headers: {
//       'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
//       'Content-Type': 'application/json'
//     },
//     data: JSON.stringify({
//       messaging_product: 'whatsapp',
//       to,
//       type: 'text',
//       text: {
//         body
//       }
//     })
//   })
// }

// async function replyMessage(to, body, messageId) {
//   await axios({
//     url: 'https://graph.facebook.com/v23.0/665252706672275/messages',
//     method: 'post',
//     headers: {
//       'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
//       'Content-Type': 'application/json'
//     },
//     data: JSON.stringify({
//       messaging_product: 'whatsapp',
//       to,
//       type: 'text',
//       text: {
//         body
//       },
//       context: {
//         message_id: messageId
//       }
//     })
//   })
// }

// async function sendList(to) {
//   await axios({
//     url: 'https://graph.facebook.com/v23.0/665252706672275/messages',
//     method: 'post',
//     headers: {
//       'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
//       'Content-Type': 'application/json'
//     },
//     data: JSON.stringify({
//       messaging_product: 'whatsapp',
//       to,
//       type: 'interactive',
//       interactive: {
//         type: 'list',
//         header: {
//           type: 'text',
//           text: 'Message Header'
//         },
//         body: {
//           text: 'This is a interactive list message'
//         },
//         footer: {
//           text: 'This is the message footer'
//         },
//         action: {
//           button: 'Tap for the options',
//           sections: [
//             {
//               title: 'First Section',
//               rows: [
//                 {
//                   id: 'first_option',
//                   title: 'First option',
//                   description: 'This is the description of the first option'
//                 },
//                 {
//                   id: 'second_option',
//                   title: 'Second option',
//                   description: 'This is the description of the second option'
//                 }
//               ]
//             },
//             {
//               title: 'Second Section',
//               rows: [
//                 {
//                   id: 'third_option',
//                   title: 'Third option'
//                 }
//               ]
//             }
//           ]
//         }
//       }
//     })
//   })
// }

// async function sendReplyButtons(to) {
//   await axios({
//     url: 'https://graph.facebook.com/v23.0/665252706672275/messages',
//     method: 'post',
//     headers: {
//       'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
//       'Content-Type': 'application/json'
//     },
//     data: JSON.stringify({
//       messaging_product: 'whatsapp',
//       to,
//       type: 'interactive',
//       interactive: {
//         type: 'button',
//         header: {
//           type: 'text',
//           text: 'Message Header'
//         },
//         body: {
//           text: 'This is a interactive reply buttons message'
//         },
//         footer: {
//           text: 'This is the message footer'
//         },
//         action: {
//           buttons: [
//             {
//               type: 'reply',
//               reply: {
//                 id: 'first_button',
//                 title: 'First Button'
//               }
//             },
//             {
//               type: 'reply',
//               reply: {
//                 id: 'second_button',
//                 title: 'Second Button'
//               }
//             }
//           ]
//         }
//       }
//     })
//   })
// }

// app.listen(5000, () => {
//   console.log('Server started on port 5000')
// })
