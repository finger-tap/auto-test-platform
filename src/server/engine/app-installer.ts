// 2026-06-23: App installer — install APK/IPA/HAP on local or remote devices.
//
// Supports Android (adb), iOS (ideviceinstaller), Harmony (hdc).
// Remote devices: SSH sftpUpload + execCommand.
// Local devices: child_process.exec.

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DeviceRow } from '../db/devices.js';
import { connectSsh, sftpUpload, execCommand, type SshCredentials } from '../agent-push/ssh-client.js';
import { decryptColumn } from '../agent-push/crypto.js';

const execAsync = promisify(exec);

export interface InstallAppOpts {
  filePath: string;               // local APK/IPA/HAP path on the server
  platform: 'android' | 'ios' | 'harmony';
  serial?: string;                // device serial (adb -s / hdc -t)
  device?: DeviceRow;             // remote device (has SSH creds)
  isRemote: boolean;
}

export interface InstallResult {
  success: boolean;
  message: string;
  duration_ms: number;
}

/**
 * Install an app package on a device.
 * - Remote: sftpUpload to /tmp/ then exec install command over SSH.
 * - Local: exec install command directly on this machine.
 */
export async function installAppOnDevice(opts: InstallAppOpts): Promise<InstallResult> {
  const start = Date.now();
  const { filePath, platform, serial, device, isRemote } = opts;

  if (!fs.existsSync(filePath)) {
    throw new Error(`安装包不存在: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase(); // .apk / .ipa / .hap
  const remoteTmpPath = `/tmp/app-install-${Date.now()}${ext}`;

  if (isRemote && device) {
    // ── Remote: SSH upload + install ──
    const creds = sshCredsForDevice(device);
    const { conn, end } = await connectSsh(creds);
    try {
      console.log(`[app-installer] uploading ${filePath} → ${device.ssh_host}:${remoteTmpPath}`);
      const src = fs.createReadStream(filePath);
      await sftpUpload(conn, remoteTmpPath, src);
      src.close();

      console.log(`[app-installer] installing on remote device platform=${platform} serial=${serial ?? '-'}`);
      const cmd = buildInstallCommand(platform, serial, remoteTmpPath);
      const result = await execCommand(conn, cmd, `install-${platform}`);

      if (result.code !== 0) {
        throw new Error(`安装命令失败 (code=${result.code}): ${result.stderr || result.stdout}`);
      }

      // Cleanup remote temp file
      await execCommand(conn, `rm -f ${remoteTmpPath}`, 'cleanup').catch(() => {});

      const ms = Date.now() - start;
      console.log(`[app-installer] remote install OK platform=${platform} ${ms}ms`);
      return { success: true, message: `安装成功 (${ms}ms)`, duration_ms: ms };
    } catch (err) {
      // Cleanup on failure
      await execCommand(conn, `rm -f ${remoteTmpPath}`, 'cleanup-catch').catch(() => {});
      throw err;
    } finally {
      end();
    }
  } else {
    // ── Local: direct exec ──
    console.log(`[app-installer] local install platform=${platform} serial=${serial ?? '-'} file=${filePath}`);
    const cmd = buildInstallCommand(platform, serial, filePath);
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
      const ms = Date.now() - start;
      console.log(`[app-installer] local install OK platform=${platform} ${ms}ms`);
      return { success: true, message: `安装成功 (${ms}ms)`, duration_ms: ms };
    } catch (err: any) {
      const msg = err.stderr || err.stdout || err.message;
      throw new Error(`安装失败: ${msg}`);
    }
  }
}

/**
 * Build the platform-specific install command.
 */
function buildInstallCommand(
  platform: 'android' | 'ios' | 'harmony',
  serial: string | undefined,
  filePath: string,
): string {
  switch (platform) {
    case 'android': {
      const serialFlag = serial ? `-s ${shellEscape(serial)}` : '';
      return `adb ${serialFlag} install -r -d ${shellEscape(filePath)}`;
    }
    case 'ios': {
      // ideviceinstaller: -U = uninstall first (upgrade), -i = install
      const serialFlag = serial ? `-u ${shellEscape(serial)}` : '';
      return `ideviceinstaller ${serialFlag} -i ${shellEscape(filePath)}`;
    }
    case 'harmony': {
      const serialFlag = serial ? `-t ${shellEscape(serial)}` : '';
      return `hdc ${serialFlag} install ${shellEscape(filePath)}`;
    }
  }
}

/**
 * Escape a string for safe use in a shell command.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract SSH credentials from a device row (same pattern as mobile-executor).
 */
function sshCredsForDevice(device: DeviceRow): SshCredentials {
  if (!device.ssh_host || !device.ssh_user || !device.ssh_auth_type) {
    throw new Error(`设备 ${device.name} 缺少 SSH 配置（host/user/auth_type）`);
  }
  const password = device.ssh_auth_type === 'password'
    ? decryptColumn('ssh_password', device.ssh_password) ?? undefined
    : undefined;
  const privateKey = device.ssh_auth_type === 'private_key'
    ? decryptColumn('ssh_private_key', device.ssh_private_key) ?? undefined
    : undefined;
  return {
    host: device.ssh_host,
    port: device.ssh_port ?? 22,
    username: device.ssh_user,
    password,
    privateKey,
  };
}
