@echo off
cd /d "%~dp0"
start "Brick relief preview" http://127.0.0.1:8840
node serve.cjs
