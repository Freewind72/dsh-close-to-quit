# dsh-close-to-quit

让 DeepSeek Harness 桌面端的 **× 按钮可以退出应用**，而不是只能最小化到托盘。
开关在「**设置 → 通用**」，**默认仍是原来的最小化到托盘**。

## 下载安装

**[⬇ 下载 dsh-close-to-quit.zip](https://github.com/Freewind72/dsh-close-to-quit/releases/latest/download/dsh-close-to-quit.zip)**（含插件和补丁工具）

解压后，先**完全退出** DeepSeek Harness（托盘图标也要退，任务管理器里不能有它的进程），然后：

```
1) 装插件
   把 plugin/ 目录用插件管理器装进去：
   plugin_manager(action="install_bundle", target="<解压路径>/plugin")

2) 打外壳补丁
   cd shell-patch
   node extract-main.cjs "E:/dsh/resources/app.asar"
   node build-patch.cjs
   node apply-patch.cjs "E:/dsh/resources/app.asar" "E:/dsh/resources/app.asar" "main.patched.js"

3) 重启，去「设置 → 通用」找「关闭窗口按钮」，改完再重启一次生效
```

装好了是这样：`apply-patch.cjs` 输出 `APPLIED OK`。

## 为什么要两步

关闭按钮的行为写在 Electron 外壳里，插件改不动它。

- 只装插件：有开关，但点 × 还是最小化
- 只打补丁：点 × 会退出，但没开关
- **两个都做**：开关管用

## 不想要了

```powershell
# 先完全退出应用
pwsh -File shell-patch/rollback.ps1
```

插件用插件管理器移除。

> ⚠️ 两件事别做：**替换 `app.asar` 前一定要退出应用**；**别删 `app.asar.bak-close-to-quit`**（182 MB，唯一的原始备份）。
>
> ⚠️ 用 `link:` 方式装的插件，源目录**不许搬家改名**——profile 里记的是绝对路径，目标没了插件会静默消失。

## 说明

- 补丁让 `lib/main.js` 保持**同样长度**，所以不破坏 `ELECTRONASAR` 校验，不用改 exe、不用重打包
- 点 × 退出时仍会弹「有任务在跑会被打断」的确认
- 设置写进 `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\settings.json`
- 已验证：归档完整性、真实读取函数、真实关闭处理器、插件接口往返、重启后生效
- 未验证：设置行的实际外观、真的点一次 ×（需要你自己试）

MIT，见 [LICENSE](LICENSE)。