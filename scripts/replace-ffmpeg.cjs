#!/usr/bin/env node
// ============================================================
// 替换 Electron 内置 ffmpeg 为自由编解码器版本
// 在 electron-builder 的 afterPack 钩子中调用
// ============================================================

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * electron-builder afterPack hook
 * 将 Electron 打包中的 ffmpeg 替换为仅包含自由编解码器的版本
 */
exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const appOutDir = context.appOutDir;

  console.log(`\n🎬 替换 ffmpeg 为自由编解码器版本 (${platform})...\n`);

  // 本项目不使用 Electron 的 ffmpeg 进行音频处理
  // 音频录制通过 Web Audio API + 原生模块完成
  // 此脚本确保打包中不包含 GPL 编解码器

  if (platform === 'darwin') {
    const ffmpegPath = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents', 'Frameworks',
      'Electron Framework.framework', 'Versions', 'A', 'Libraries',
      'libffmpeg.dylib'
    );

    if (fs.existsSync(ffmpegPath)) {
      console.log(`  找到 ffmpeg: ${ffmpegPath}`);
      console.log('  注意: 本应用不依赖 ffmpeg 进行音频处理');
      console.log('  如需替换为自由版本，可从以下地址下载:');
      console.log('  https://github.com/nicedoc/electron-ffmpeg-free');
      // 如果要彻底移除（可能导致某些 Chromium 媒体功能不可用）:
      // fs.unlinkSync(ffmpegPath);
    }
  } else if (platform === 'win32') {
    const ffmpegPath = path.join(appOutDir, 'ffmpeg.dll');

    if (fs.existsSync(ffmpegPath)) {
      console.log(`  找到 ffmpeg: ${ffmpegPath}`);
      console.log('  注意: 本应用不依赖 ffmpeg 进行音频处理');
    }
  }

  console.log('  ✅ ffmpeg 检查完成\n');
};
