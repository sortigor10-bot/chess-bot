const path = require("node:path");
const { app, BrowserWindow } = require("electron");

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 850,
    minHeight: 650,
    backgroundColor: "#101820",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error("Не удалось запустить приложение:", error);
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error("Не удалось открыть окно приложения:", error);
        app.quit();
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
