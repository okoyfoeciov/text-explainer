document.addEventListener('DOMContentLoaded', () => {
    const contentDiv = document.getElementById('content');
    
    let accumulatedText = "";

    // Use exposed API from preload.js
    if (window.electronAPI) {
        window.electronAPI.onStreamData((chunk) => {
            accumulatedText += chunk;
            contentDiv.innerHTML = marked.parse(accumulatedText + "\n");
             // Auto-scroll to bottom
            contentDiv.scrollTop = contentDiv.scrollHeight;
        });

        window.electronAPI.onStreamEnd(() => {
            console.log("Stream ended");
        });

        window.electronAPI.onStreamError((error) => {
            console.error("Stream error:", error);
            contentDiv.innerHTML += `<br/><br/><em style="color:red">Error: ${error}</em>`;
        });
    } else {
        console.error("Electron API not found");
        contentDiv.innerHTML = "Error: Electron API not initialized.";
    }
});
