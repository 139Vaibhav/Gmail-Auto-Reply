const express = require("express");
const app = express();
const path = require('path');
const fs = require("fs").promises;
const dotenv = require("dotenv");
const catchAsyncErrors = require("./middleware/catchAsyncErrors");

const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://mail.google.com/'
];

// Handling uncaught Exception
process.on("uncaughtException", (err) => {
    console.log(`Error:${err.message}`);
    console.log(`Shutting down the server due to Uncaught Exception`);
    process.exit(1);
})


app.get("/", catchAsyncErrors(async (req, res, next) => {

    // Get client credentials
    const credentials = await fs.readFile("credentials.json");

    // Authorise the client with credentials
    const auth = await authenticate({
        keyfilePath: path.join(__dirname, 'credentials.json'),
        scopes: SCOPES,
    });

    const gmail = google.gmail({ version: 'v1', auth });

    const response = await gmail.users.labels.list({
        userId: 'me',
    });

    const LABEL_NAME = "Vacation";

    // Get credentials from file
    async function loadCredentials() {
        const filePath = path.join(process.cwd(), 'credentials.json');
        const content = await fs.readFile(filePath, { encoding: 'utf8' });
        return JSON.parse(content);
    }

    // Get messages with no prior replies
    async function getNoReplyMsgs(auth) {
        const gmail = google.gmail({ version: "v1", auth });
        const res = await gmail.users.messages.list({
            userId: "me",
            q: '-in:chats -from:me -has:userlabels',
        });
        return res.data.messages || [];
    }

    // Send Reply to a Message
    async function sendReply(auth, message) {
        const gmail = google.gmail({ version: "v1", auth });
        const res = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', "From"]
        });

        const subject = res.data.payload.headers.find(
            (header) => header.name === 'Subject'
        ).value;
        const from = res.data.payload.headers.find(
            (header) => header.name === 'From'
        ).value;

        const replyTo = from.match(/<(.*)>/)[1];
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        const replyBody = `Hi,\n\nI'm currently on a vacation and will get back to you soon. Sorry for the inconvenience \n\nThanks & Regards,\n Vaibhav Singh`;

        const rawMessage = [
            `From: me`,
            `To: ${replyTo}`,
            `Subject: ${replySubject}`,
            `In-Reply-To: ${message.id}`,
            `References: ${message.id}`,
            '',
            replyBody,
        ].join('\n');

        const encodedMessage = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');


        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });

    }

    async function createLable(auth) {
        const gmail = google.gmail({ version: "v1", auth });

        try {
            const res = await gmail.users.labels.create({
                userId: 'me',
                requestBody: {
                    name: LABEL_NAME,
                    labelListVisibility: 'labelListShow', // This can be changed
                    messageListVisibility: 'messageListshow', // This can be changed
                },
            });
            return res.data.id;
        } catch (error) {
            if (error.code === 409) {
                // Label already exists
                const res = await gmail.users.labels.list({
                    userId: 'me',
                });
                const label = res.data.labels.find((label) => label.name === LABEL_NAME);
                return label.id;
            } else {
                throw error;
            }
        }
    }

    // Add label to a message and move it to the label folder
    async function addLabel(auth, message, labelId) {
        const gmail = google.gmail({ version: 'v1', auth });
        await gmail.users.messages.modify({
            userId: 'me',
            id: message.id,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX'],
            },
        });
    }

    // Main function
    async function main() {


        // Create a label for the app
        const labelId = await createLable(auth);
        console.log(`Created or found label with id ${labelId}`);


        // Repeat the following steps in random intervals
        setInterval(async () => {

            // Get messages that do not have any prior replies

            const messages = await getUnrepliedMessages(auth);
            console.log(`Found ${messages.length} unreplied messages`);

            for (const message of messages) {

                // Sending reply to each message

                await sendReply(auth, message);
                console.log(`Sent reply to message with id ${message.id}`);

                // Add label to the message and move it to the label folder

                await addLabel(auth, message, labelId);
                console.log(`Added label to message with id ${message.id}`);
            }
        }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000); // Random interval between 45 and 120 seconds
    }

    main().catch(console.error);

    const labels = response.data.labels;

    res.send("You are successfully eligible for our service");

}))


//Config
dotenv.config({ path: "config/config.env" });

const server = app.listen(process.env.port, () => {
    console.log(`server is running on http://localhost:${process.env.port}`)
})

// Unhandled Promise Rejection
process.on("unhandledRejection", err => {
    console.log(`Error: ${err.message}`);
    console.log(`Shutting down the server due to unhandled Promise Rejection`);

    server.close(() => {
        process.exit(1);
    });
})