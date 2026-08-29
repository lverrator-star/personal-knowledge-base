@echo off
chcp 65001 >nul
pushd "%~dp0"

echo ==========================================
echo   个人知识库 - 更新静态预览并发布
echo ==========================================
echo.

echo [1/4] 重新生成静态预览...
node server\export-static.mjs
if errorlevel 1 goto :fail_gen

echo [2/4] 切换到 gh-pages 分支...
git switch gh-pages
if errorlevel 1 goto :fail_switch

git rm --cached index.html app.js style.css data.js manifest.json icon.svg personal-kb.md personal-kb.json >nul 2>&1
del index.html 2>nul
del app.js 2>nul
del style.css 2>nul
del data.js 2>nul
del manifest.json 2>nul
del icon.svg 2>nul
del personal-kb.md 2>nul
del personal-kb.json 2>nul
copy preview\index.html . >nul
copy preview\app.js . >nul
copy preview\style.css . >nul
copy preview\data.js . >nul
copy preview\manifest.json . >nul
copy preview\icon.svg . >nul
copy preview\personal-kb.md . >nul
copy preview\personal-kb.json . >nul
git add index.html app.js style.css data.js manifest.json icon.svg personal-kb.md personal-kb.json

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo 数据没有变化，无需发布。
  git switch main >nul 2>&1
  pause
  exit /b 0
)

echo [3/4] 提交并推送到 GitHub...
git commit -m "更新静态预览"
if errorlevel 1 goto :fail_commit

git push
if errorlevel 1 (
  echo.
  echo 推送失败（可能是网络问题）。已切回 main 分支，网络恢复后重新双击本脚本即可。
  git switch main >nul 2>&1
  pause
  exit /b 1
)

echo [4/4] 切回 main 分支...
git switch main >nul 2>&1
echo.
echo 完成！预览已发布（约 1 分钟后生效）：
echo https://lverrator-star.github.io/personal-knowledge-base/
echo.
pause
exit /b 0

:fail_gen
echo.
echo 生成失败，已取消。请查看上面的报错信息。
pause
exit /b 1

:fail_switch
echo.
echo 切换分支失败。请先提交或暂存 main 分支上的改动，再运行本脚本。
pause
exit /b 1

:fail_commit
echo.
echo 提交失败。已切回 main 分支。
git switch main >nul 2>&1
pause
exit /b 1
