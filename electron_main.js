require('dotenv').config();
const { app, BrowserWindow } = require('electron');
const path = require('path');
const OpenAI = require('openai');

let mainWindow;

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

// Current model index - Randomly selected from the model list
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

async function startStream(text, modelIndex = currentModelIndex) {
    if (!mainWindow) return;

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
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                mainWindow.webContents.send('stream-data', content);
            }
        }
        mainWindow.webContents.send('stream-end');
    } catch (error) {
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
                mainWindow.webContents.send('stream-error', "Tất cả model đều bị rate limit. Vui lòng thử lại sau.");
                return;
            }
            console.log(`Rate limited on ${model.Name} - ${model.Model}, switching to model index ${nextIndex}...`);
            mainWindow.webContents.send('stream-data', `\n\n*[Rate limited on ${model.Name} - ${model.Model}, switching to ${models[nextIndex].Name} - ${models[nextIndex].Model}...]*\n\n`);
            return startStream(text, nextIndex);
        }

        mainWindow.webContents.send('stream-error', error.message || String(error));
    }
}

function createWindow() {
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
        
        // Start processing logic
        const text = process.env.EXPLAIN_TEXT;
        if (text) {
             startStream(text);
        } else {
             console.log("No EXPLAIN_TEXT environment variable provided.");
        }
    });

    // Load local static files directly
    mainWindow.loadFile(path.join(__dirname, 'static', 'index.html'));

    mainWindow.on('closed', function () {
        mainWindow = null;
    });

    mainWindow.on('blur', () => {
        if (mainWindow) {
            mainWindow.close();
        }
    });
}

const gotTheLock = app.requestSingleInstanceLock();
// We allow multiple instances now to handle multiple explanations if triggered rapidly
// But usually script kills? No, script calls electron.
// If we want to allow new text we should probably drop single instance lock OR handle second-instance properly.
// User requested: "handle all by electron... llm-proxy had tray... now remove tray".
// I'll drop the Single Instance Lock logic to allow new calls to spawn new windows with new text.
// This is the simplest way to support the "command line launch with new text".

app.on('ready', () => {
    createWindow();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
    if (mainWindow === null) createWindow();
});
