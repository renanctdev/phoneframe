// electron-builder afterPack hook: writes the PhoneFrame product metadata
// (name, description, company, copyright) into PhoneFrame.exe.
//
// electron-builder normally does this itself ("signAndEditExecutable"), but it
// needs the winCodeSign tool, whose archive contains symlinks that Windows only
// lets you extract with admin rights or Developer Mode. This hook uses the
// standalone `rcedit` package instead, so `npm run dist` works on any machine.
const path = require("path");
const rcedit = require("rcedit");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const info = context.packager.appInfo;
  const exeName = `${context.packager.platformSpecificBuildOptions.executableName || info.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);

  const company = info.companyName || "";
  await rcedit(exePath, {
    "version-string": {
      ProductName: info.productName,
      FileDescription: info.description || info.productName,
      CompanyName: company,
      LegalCopyright: info.copyright || "",
      OriginalFilename: exeName,
      InternalName: info.productName,
    },
    "file-version": info.shortVersion || info.buildVersion,
    "product-version": info.shortVersionWindows || info.getVersionInWeirdWindowsForm(),
  });
};
