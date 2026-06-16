<p align="center">
  <a href="https://ottili.one/coder">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Ottili Coder logo">
    </picture>
  </a>
</p>
<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
<p align="center">
  <a href="https://ottili.one/coder/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/ottili-coder-ai"><img alt="npm" src="https://img.shields.io/npm/v/ottili-coder-ai?style=flat-square" /></a>
  <a href="https://github.com/Ottili-ONE/coder-cli/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Ottili-ONE/coder-cli/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Ottili Coder Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://ottili.one/coder)

---

### ইনস্টলেশন (Installation)

```bash
# YOLO
curl -fsSL https://ottili.one/coder/install | bash

# Package managers
npm i -g ottili-coder-ai@latest        # or bun/pnpm/yarn
scoop install ottili-coder             # Windows
choco install ottili-coder             # Windows
brew install anomalyco/tap/ottili-coder # macOS and Linux (recommended, always up to date)
brew install ottili-coder              # macOS and Linux (official brew formula, updated less)
sudo pacman -S ottili-coder            # Arch Linux (Stable)
paru -S ottili-coder-bin               # Arch Linux (Latest from AUR)
mise use -g ottili-coder               # Any OS
nix run nixpkgs#ottili-coder           # or github:Ottili-ONE/coder-cli for latest dev branch
```

> [!TIP]
> ইনস্টল করার আগে ০.১.x এর চেয়ে পুরোনো ভার্সনগুলো মুছে ফেলুন।

### ডেস্কটপ অ্যাপ (BETA)

Ottili Coder ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/Ottili-ONE/coder-cli/releases) অথবা [ottili.one/coder/download](https://ottili.one/coder/download) থেকে ডাউনলোড করুন।

| প্ল্যাটফর্ম           | ডাউনলোড                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `ottili-coder-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `ottili-coder-desktop-mac-x64.dmg`     |
| Windows               | `ottili-coder-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask ottili-coder-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/ottili-coder-desktop
```

#### ইনস্টলেশন ডিরেক্টরি (Installation Directory)

ইনস্টল স্ক্রিপ্টটি ইনস্টলেশন পাতের জন্য নিম্নলিখিত অগ্রাধিকার ক্রম মেনে চলে:

1. `$OTTILI_CODER_INSTALL_DIR` - কাস্টম ইনস্টলেশন ডিরেক্টরি
2. `$XDG_BIN_DIR` - XDG বেস ডিরেক্টরি স্পেসিফিকেশন সমর্থিত পাথ
3. `$HOME/bin` - সাধারণ ব্যবহারকারী বাইনারি ডিরেক্টরি (যদি বিদ্যমান থাকে বা তৈরি করা যায়)
4. `$HOME/.ottili-coder/bin` - ডিফল্ট ফলব্যাক

```bash
# উদাহরণ
OTTILI_CODER_INSTALL_DIR=/usr/local/bin curl -fsSL https://ottili.one/coder/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ottili.one/coder/install | bash
```

### এজেন্টস (Agents)

Ottili Coder এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](https://ottili.one/coder/docs/agents)।

### ডকুমেন্টেশন (Documentation)

কিভাবে Ottili Coder কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](https://ottili.one/coder/docs)।

### অবদান (Contributing)

আপনি যদি Ottili Coder এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### Ottili Coder এর উপর বিল্ডিং (Building on Ottili Coder)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা Ottili Coder এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "ottili-coder" ব্যবহার করেন, উদাহরণস্বরূপ "ottili-coder-dashboard" বা "ottili-coder-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি Ottili Coder দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

---

**আমাদের কমিউনিটিতে যুক্ত হোন** [Discord](https://discord.gg/ottili-coder) | [X.com](https://x.com/ottili-coder)
