// En Mac, firma la app "ad hoc" (sin certificado de Apple). Sin esto, macOS en chips M
// diría que la app "está dañada"; con esto solo muestra el aviso normal de app no verificada.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • firma ad hoc aplicada a ${path.basename(app)}`);
};
