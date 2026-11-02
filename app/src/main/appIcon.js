// Ícone das janelas quando o app roda em desenvolvimento (npm start).
//
// No app empacotado o Windows usa o ícone gravado dentro do PhoneFrame.exe
// (scripts/after-pack.js). A pasta build/ não vai para o app.asar, então lá
// o arquivo não existe e o valor fica undefined (o BrowserWindow usa o do exe).
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "..", "build", "icon.ico");

module.exports = { APP_ICON: fs.existsSync(file) ? file : undefined };
