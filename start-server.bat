@echo off
chcp 65001 >nul
rem 个人知识库服务启动脚本（隐藏窗口运行，可开机自启）
pushd "%~dp0"

rem 已在运行就退出，避免端口冲突
netstat -ano | findstr ":8787 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 exit /b

node server\server.mjs >> data\server.log 2>&1
