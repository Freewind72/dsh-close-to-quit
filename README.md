# dsh-close-to-quit

让 DeepSeek Harness 桌面端的**窗口关闭按钮（×）**可以**退出应用**，而不是只能最小化到托盘。
这个行为在「**设置 → 通用**」里用一个开关控制，**默认仍是原来的最小化到托盘**，不动开关就一切照旧。

---

## 一、下载安装

**不用克隆仓库，直接下载就能装：**

### 👉 [点这里下载 dsh-close-to-quit.zip](https://github.com/Freewind72/dsh-close-to-quit/releases/latest/download/dsh-close-to-quit.zip)

这是完整包，含插件 + 外壳补丁工具 + 中文说明。解压后按第三节装。

只想要插件本体（`pnpm add` 用）：
[dsh-close-to-quit-1.0.0.tgz](https://github.com/Freewind72/dsh-close-to-quit/releases/latest/download/dsh-close-to-quit-1.0.0.tgz)

也可以 git clone：

```bash
git clone https://github.com/Freewind72/dsh-close-to-quit.git
```

---

## 二、这个插件分两层，缺一不可

关闭按钮的行为写在 Electron 外壳的 `lib/main.js` 里（`window.on("close")` → `preventDefault()` → 隐藏窗口）。
外壳不是 Cordis 插件，插件改不动它，所以必须两层配合：

| 层 | 位置 | 作用 |
|---|---|---|
| **外壳补丁** | `resources/app.asar` 里的 `lib/main.js` | 真正改变行为：读到 `quit` 就 `app.quit()` |
| **插件** | `plugin/`（Cordis bundle） | 在「设置 → 通用」画开关，读写同一个偏好 |

| 只装插件 | 只打外壳补丁 | 两层都做 |
|---|---|---|
| 开关能存值，但点 × 还是最小化到托盘 | 行为变了，但没有开关可用 | 开关可用，点 × 真的按开关走 |

---

## 三、安装步骤

### 前置条件

- 已安装 **DeepSeek Harness 桌面版**（本项目在 `@deepseek-ai/dsh-desktop 0.2.1-rc.5` 上验证）
- 装了 Node.js（跑补丁脚本用，任意较新版本）
- 默认安装目录是 `E:\dsh`；不是这个路径的话，下面命令里替换成你的实际路径
- `rollback.ps1` 需要 Windows PowerShell；补丁脚本本身跨平台

### 第 1 步：装插件

**方式 A：用插件管理器装目录（推荐，能显示图标与名称）**

在 DSH 会话里执行：

```
plugin_manager(action="install_bundle", target="<解压后的绝对路径>/plugin")
```

**方式 B：用 pnpm 装 tgz**

```bash
pnpm add <解压后的绝对路径>/dsh-close-to-quit-1.0.0.tgz
```

装完确认 profile 的 `cordis.patch.yml` 里出现了这一行：

```yaml
- insert:
    - id: close-to-quit
      name: dsh-close-to-quit
```

> ⚠️ **用 `link:` 方式装的话，源目录不许搬家、改名或删除。** profile 的 `package.json`
> 记的是绝对路径，目标一旦消失，插件会在重启后静默消失、不报任何错。
> 要整理目录，先改 `link:` 路径再 `pnpm install`，顺序不能反。

### 第 2 步：打外壳补丁

**必须先完全退出 DeepSeek Harness** —— 关掉窗口不够，托盘图标要退出，任务管理器里不能再有 `DeepSeek Harness` 进程。

```bash
cd shell-patch

# 1) 从你的安装里取出 lib/main.js（这个文件仓库里没有，属于 DeepSeek 自己的代码）
node extract-main.cjs "E:/dsh/resources/app.asar"

# 2) 生成等长补丁
node build-patch.cjs

# 3) 应用补丁（写之前会先校验归档头部哈希，不匹配就拒绝写）
node apply-patch.cjs "E:/dsh/resources/app.asar" "E:/dsh/resources/app.asar" "main.patched.js"
```

`apply-patch.cjs` 的正常输出应该是这样：

```
header sha256 = 69828bdcbb189485291e3901a027d46d2f665a36fc8441034052da328b173ba9
integrity MATCHES ELECTRONASAR value
payload readback identical = true
archive size: src=182766714 dst=182766714 equal=true
APPLIED OK
```

### 第 3 步：重启并选择

1. 重新启动 DeepSeek Harness
2. 打开「**设置 → 通用**」，找到「**关闭窗口按钮**」
   （位置在「打开链接」下面、「输入框回车」上面）
3. 打开开关 = 点 × 退出应用；关闭 = 点 × 最小化到托盘（默认）
4. 改完**再重启一次**才生效 —— 外壳每个进程只读一次设置文件

---

## 四、验证

```bash
# 归档完整性 + 条目长度（已打补丁和原版都能查）
node tests/verify-archive.mjs "E:/dsh/resources/app.asar"

# 证明补丁能从原版归档完整复现出来
node tests/verify-archive.mjs "E:/dsh/resources/app.asar.bak-close-to-quit" --pristine

# 跑外壳里真实的 readDesktopSettings 和真实的关闭处理器
node tests/shell-behaviour.mjs "E:/dsh/resources/app.asar"

# 插件的 Host 半：读取、写入、各种拒绝路径、三种桌面状态
node tests/host-route.mjs

# 插件是否真的装在了加载器要找的位置
node tests/bundle-installed.mjs
```

也可以用环境变量代替命令行参数：

```bash
DSH_ASAR="E:/dsh/resources/app.asar" node tests/verify-archive.mjs
```

确认偏好真的写进去了（路径是 `%APPDATA%\@deepseek-ai\dsh-desktop\desktop\settings.json`）：

```powershell
Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\settings.json" -Raw
```

选「退出应用」后应该能看到 `"closeButtonAction": "quit"`。

---

## 五、为什么补丁必须「等长」

安装包里有个 `INTEGRITY/ELECTRONASAR` 资源，声明了 `resources/app.asar` 的 SHA-256。
**实测确认：这个哈希只覆盖 asar 头部 JSON**（文件偏移 `16..16+jsonSize`），**不覆盖各文件内容**——
对整包算哈希反而不匹配，只对头部算就完全吻合。

所以改 payload 内容不会被校验发现，**但长度一变就必须重写头部里的偏移**，那会改变头部 JSON，
哈希就失配了。

因此补丁做成**字节数完全不变**：`lib/main.js` 改完仍是 **516716 字节**。

- 4 处代码改动共多出 274 字节
- 由 `writeFileAtomic` 上方一段 JSDoc 从 1000 字节压到 726 字节补回

只删注释里的散文，代码语义不变，`node --check` 通过。

> 如果将来要改的地方更多、凑不出等长，就必须重写头部**并且**重算 exe 里的 `INTEGRITY` 资源，
> 那是另一个量级的活。

头部里每个条目还带一个 `integrity` 字段，补丁后它会失效。**Electron 不校验它**——
条目 payload 是从数据区直接读的。`tests/verify-archive.mjs` 会把两个哈希都打出来，
让这个差异看得见，而不是藏起来。

---

## 六、补丁具体改了什么

| # | 位置 | 改动 |
|---|---|---|
| 1 | `readDesktopSettings` 的默认值 | 增加 `closeButtonAction: "tray"` |
| 2 | `readDesktopSettings` 的返回值 | 增加该字段，只接受 `"tray"` / `"quit"` |
| 3 | 窗口 `close` 处理器 | 值为 `"quit"` 时调 `app.quit()`，走隐藏逻辑之前 |
| 4 | Host 子进程环境 | 增加 `DSH_DESKTOP_USER_DATA`，让插件能找到设置文件 |
| 5 | `writeFileAtomic` 的 JSDoc | 1000 → 726 字节，保持文件总长不变 |

退出分支的位置很关键，它**在更新对话框判断之后**、**在 `quitting` / `shellInstallerOwnsQuit` /
`sessionEnding` 提前返回之后**，所以：

- 更新对话框开着时，关窗口仍然优先聚焦对话框
- 系统关机、安装器发起的退出路径完全不受影响
- `app.quit()` 仍会走外壳自己的 `before-quit` 确认，**「有任务在跑会被打断」的提示保留**

无法识别的 `closeButtonAction` 值会回落成 `"tray"`，而不是抛错——
`readDesktopSettings` 失败时外壳会退回默认值，一个拼错的值绝不能把启动搞崩。

---

## 七、回滚

```powershell
# 先完全退出应用
pwsh -File shell-patch/rollback.ps1
```

会从 `app.asar.bak-close-to-quit` 恢复 `resources/app.asar` 并校验哈希。
插件另外用插件管理器停用或移除。

---

## 八、目录结构

```
.
├── plugin/                  # Cordis 插件（Host 半 + Client 半）
│   ├── package.json         # dsh.bundle.patch + dsh.client
│   ├── cordis.patch.yml     # 一行 insert
│   ├── index.js             # Host 半：/dsh-close-to-quit/{state,set}
│   ├── client.js            # Client 半：「设置 → 通用」那一行
│   ├── locale/{zh,en}.json  # 显示名称与简介
│   └── icon.svg
├── shell-patch/
│   ├── extract-main.cjs     # 从 app.asar 取出 lib/main.js
│   ├── build-patch.cjs      # main.orig.js → main.patched.js（等长）
│   ├── apply-patch.cjs      # 写入补丁，写前校验头部哈希
│   └── rollback.ps1         # 从备份恢复
├── tests/
│   ├── lib/asar.mjs          # 零依赖的 asar 读取器
│   ├── verify-archive.mjs    # 头部完整性、条目长度、payload 内容
│   ├── shell-behaviour.mjs   # 真实的 readDesktopSettings + 真实的关闭处理器
│   ├── host-route.mjs        # 插件 Host 半、拒绝路径、三种桌面状态
│   └── bundle-installed.mjs  # 插件是否装在加载器要找的位置
└── dist/                     # 发布产物（Release 里挂的就是这两个）
```

`main.orig.js` 和 `main.patched.js` **不入库**：前者是 DeepSeek 自己的代码，
两者都能用上面两个脚本从本机安装现场重新生成。

---

## 九、坑

- **替换 `app.asar` 前必须完全退出应用。** Windows 在应用运行时会把归档占着，
  写一半就损坏安装。
- **`app.asar.bak-close-to-quit`（约 182 MB）别删。** 那是唯一的原始归档。
- **外壳每个进程只读一次设置文件。** 任何改动都要重启；行内会明说重启，而不是假装立即生效。
- **`DSH_DESKTOP_USER_DATA` 是判断外壳是否已打补丁的唯一信号。** 打补丁前启动的外壳没有这个变量，
  所以插件会区分 `patched` / `shell` / `standalone` 三态，提示用户重启，
  而不是谎称「这一项不能改」。
- **不要手工改头部 JSON 里的偏移。** 那会破坏 `ELECTRONASAR` 哈希。
- **用 `link:` 装的插件，源目录不许搬家。** 详见第三节的警告。

---

## 十、已验证 / 未验证

**已验证**（开发机上实测通过）：

- 归档头部 SHA-256 与 `ELECTRONASAR` 声明值一致
- `lib/main.js` 与整包长度均未变（516716 / 182766714）
- Electron 自身读取 asar 路径全部正常（含 `main.js`、`preload-app.cjs`、前端 dist）
- 重启 exe 退出码 0（说明 `main.js` 完整解析并执行到单实例抢占）
- 从归档取真实 `readDesktopSettings` 跑 8 种输入，全部符合预期
- 从归档取真实关闭处理器跑 5 组场景，tray 分支与原版逐项一致
- 插件 Host 路由 11 项，含 403 / 405 / 400 各拒绝路径
- 三种桌面状态判断 4 项
- 真实 HTTP `state` / `set` 往返成功，偏好文件正确写入
- 插件行已注册：`settings.general.item` → `close-to-quit` / order 18 / active
- 重启后 `desktop` 状态由 `shell` 变为 `patched`，证明打补丁的外壳确实在运行
- 发布包解压后 `extract → build → apply` 全流程独立可跑

**未验证**（需要人在目标机上确认）：

- 设置行在浏览器里的实际渲染（开关外观、中英文文案、重启提示的位置）——
  只验证到 slot 已注册
- 真实点一次 × 的行为——分支逻辑是对归档里真实代码验证的，但没有在运行中的窗口上点过

---

## 许可证

MIT，见 [LICENSE](LICENSE)。该许可只覆盖本项目自己的代码（Cordis 插件与补丁/测试脚本）。

它**不覆盖** DeepSeek Harness 及其任何部分。本项目就地修改已安装的那份应用，
既不附带也不再分发它的代码；那份应用自身的许可条款管辖它。
`shell-patch/main.orig.js` 是从你自己的安装现场生成的，因此被 git 忽略。
