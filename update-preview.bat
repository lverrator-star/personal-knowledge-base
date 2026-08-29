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

echo [2/4] 准备 gh-pages 发布目录...
git worktree remove --force .gh-pages >nul 2>&1
git worktree add .gh-pages gh-pages >nul
if errorlevel 1 goto :fail_switch

del .gh-pages\index.html 2>nul
del .gh-pages\app.js 2>nul
del .gh-pages\style.css 2>nul
del .gh-pages\data.js 2>nul
del .gh-pages\manifest.json 2>nul
del .gh-pages\icon.svg 2>nul
del .gh-pages\personal-kb.md 2>nul
del .gh-pages\personal-kb.json 2>nul
copy preview\index.html .gh-pages\ >nul
copy preview\app.js .gh-pages\ >nul
copy preview\style.css .gh-pages\ >nul
copy preview\data.js .gh-pages\ >nul
copy preview\manifest.json .gh-pages\ >nul
copy preview\icon.svg .gh-pages\ >nul
copy preview\personal-kb.md .gh-pages\ >nul
copy preview\personal-kb.json .gh-pages\ >nul

echo [3/4] 提交并推送到 GitHub...
git -C .gh-pages add -A
git -C .gh-pages commit -m "更新静态预览" >nul 2>&1
if errorlevel 1 echo      （数据没有变化，跳过提交）
git -C .gh-pages push
if errorlevel 1 goto :fail_push

echo [4/4] 清理发布目录...
git worktree remove --force .gh-pages >nul 2>&1
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
echo 创建发布目录失败。请确认 gh-pages 分支存在、且 main 分支没有未提交的改动。
pause
exit /b 1

:fail_push
echo.
echo 推送失败（可能是网络问题）。稍后网络恢复后重新双击本脚本即可。
git worktree remove --force .gh-pages >nul 2>&1
pause
exit /b 1
