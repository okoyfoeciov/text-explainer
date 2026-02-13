require('dotenv').config();
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const OpenAI = require('openai');

const SOCKET_PATH = '/tmp/text-explainer.sock';

let mainWindow = null;
let streamGeneration = 0; // incremented on each new request to abort stale streams

// Models configuration
const models = [
    {
        Name: "Cerebras",
        BaseURL: "https://api.cerebras.ai/v1",
        Model: "zai-glm-4.7",
        APIKey: process.env.CEREBRAS_API_KEY,
        ReasoningEffort: "none",
    },
    {
        Name: "Cerebras",
        BaseURL: "https://api.cerebras.ai/v1",
        Model: "gpt-oss-120b",
        APIKey: process.env.CEREBRAS_API_KEY,
        ReasoningEffort: "high",
    },
    {
        Name: "Groq",
        BaseURL: "https://api.groq.com/openai/v1",
        Model: "openai/gpt-oss-120b",
        APIKey: process.env.GROQ_API_KEY,
        ReasoningEffort: "high",
    },
    {
        Name: "Groq",
        BaseURL: "https://api.groq.com/openai/v1",
        Model: "moonshotai/kimi-k2-instruct",
        APIKey: process.env.GROQ_API_KEY,
        ReasoningEffort: "none",
    }
];

let currentModelIndex = Math.floor(Math.random() * models.length);

function cleanText(text) {
    if (!text) return "";
    // Preserve paragraph breaks
    text = text.replace(/\n\n/g, "§PARAGRAPH§");
    // Replace single newlines with spaces
    text = text.replace(/\n/g, " ");
    // Restore paragraph breaks
    text = text.replace(/§PARAGRAPH§/g, "\n\n");
    // Clean multiple spaces
    text = text.replace(/ +/g, " ");
    return text.trim();
}

async function startStream(text, modelIndex, gen) {
    // Abort if a newer request has taken over
    if (gen !== streamGeneration) return;

    const targetWindow = mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) return;

    const cleanedText = cleanText(text);
    const model = models[modelIndex];

    console.log(`Starting stream with model ${model.Name} - ${model.Model} (index ${modelIndex})`);

    const client = new OpenAI({
        apiKey: model.APIKey,
        baseURL: model.BaseURL,
        timeout: 60000 // 60s timeout
    });

    try {
        const params = {
            model: model.Model,
            messages: [
                {
                    role: "system",
                    content: `Trả lời câu hỏi một cách ngắn gọn, bao gồm đầy đủ thông tin cần thiết để giải quyết trọn vẹn yêu cầu, tránh các chi tiết, ví dụ hoặc nội dung lan man không cần thiết trừ khi được yêu cầu cụ thể.
Tôi sẽ cung cấp cho bạn đoạn text, có ba trường hợp:
1. Nếu nó là một đoạn source code, hãy giải thích đoạn code đó.
2. Nếu nó là một bài báo, một blog, một article, một paper, hãy phân tích đầy đủ các luận điểm của nó. Muốn rơi vào trường hợp này thì đoạn text phải lớn hơn 300 từ.
3. Nêu là một đoạn từ, một cụm từ hoặc một câu bất kỳ, hoặc một lời nói, một đoạn hội thoại, một câu bình luận, hãy dịch nghĩa đoạn đó sang tiếng Việt. Nếu có những jargon, những tiếng lóng, thành ngữ hay cụm từ không thông dụng, thì giải thích thêm. Nhớ rằng phần đầu tiên của câu trả lời phải luôn là bản dịch, không đi kèm bất cứ một lời giới thiệu nào.
Lưu ý, chỉ có thể là một trong ba, hãy trả lời ứng với chỉ trường hợp đó.`
                },
                {
                    role: "user",
                    content: `"${cleanedText}"`
                }
            ],
            stream: true
        };

        if (model.ReasoningEffort && model.ReasoningEffort !== "none") {
            params.reasoning_effort = model.ReasoningEffort;
        }

        const stream = await client.chat.completions.create(params);

        for await (const chunk of stream) {
            if (gen !== streamGeneration || !targetWindow || targetWindow.isDestroyed()) return;
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                targetWindow.webContents.send('stream-data', content);
            }
        }
        if (gen === streamGeneration && targetWindow && !targetWindow.isDestroyed()) {
            targetWindow.webContents.send('stream-end');
        }
    } catch (error) {
        if (gen !== streamGeneration || !targetWindow || targetWindow.isDestroyed()) return;

        console.error("OpenAI Stream Error:", error);

        // Auto-switch model on 429 rate limit error
        const is429 = error.status === 429
            || (error.message && error.message.includes('429'))
            || (error.code === 'rate_limit_exceeded');

        if (is429) {
            const nextIndex = (modelIndex + 1) % models.length;
            // If we've cycled through all models, give up
            if (nextIndex === currentModelIndex) {
                console.error("All models rate-limited. Giving up.");
                targetWindow.webContents.send('stream-error', "Tất cả model đều bị rate limit. Vui lòng thử lại sau.");
                return;
            }
            console.log(`Rate limited on ${model.Name} - ${model.Model}, switching to model index ${nextIndex}...`);
            targetWindow.webContents.send('stream-data', `\n\n*[Rate limited on ${model.Name} - ${model.Model}, switching to ${models[nextIndex].Name} - ${models[nextIndex].Model}...]*\n\n`);
            return startStream(text, nextIndex, gen);
        }

        targetWindow.webContents.send('stream-error', error.message || String(error));
    }
}

function createWindowAndStream(text) {
    // Close existing window if any
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners('blur');
        mainWindow.close();
        mainWindow = null;
    }

    // New generation - invalidates any running stream
    const gen = ++streamGeneration;
    currentModelIndex = Math.floor(Math.random() * models.length);

    mainWindow = new BrowserWindow({
        width: 351,
        height: 810,
        x: 1430,
        y: 150,
        title: '',
        autoHideMenuBar: true,
        backgroundColor: '#0f1011',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        startStream(text, currentModelIndex, gen);
    });

    mainWindow.loadFile(path.join(__dirname, 'static', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.on('blur', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }
    });
}

// --- IPC Server via Unix domain socket ---
function startIPCServer() {
    try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}

    const server = http.createServer((req, res) => {
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const text = body.trim();
                if (text) {
                    createWindowAndStream(text);
                }
                res.writeHead(200);
                res.end('OK');
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(SOCKET_PATH, () => {
        fs.chmodSync(SOCKET_PATH, 0o600);
        console.log(`IPC server listening on ${SOCKET_PATH}`);
    });

    server.on('error', (err) => {
        console.error('IPC server error:', err);
    });
}

// --- Socket cleanup ---
function cleanupSocket() {
    try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
}
app.on('will-quit', cleanupSocket);
process.on('SIGINT', () => { cleanupSocket(); process.exit(); });
process.on('SIGTERM', () => { cleanupSocket(); process.exit(); });

// --- App lifecycle ---
app.on('ready', () => {
    startIPCServer();

    // Handle initial launch with EXPLAIN_TEXT env var
    const text = process.env.EXPLAIN_TEXT;
    if (text) {
        createWindowAndStream(text);
    }
});

// Keep running in background - no window = no taskbar icon on Linux
app.on('window-all-closed', () => {
    // Intentionally empty: stay alive as a background daemon
    // for near-instant response on subsequent calls
});
