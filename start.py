"""Agent Zero 启动脚本 - 检查环境并启动项目."""

import logging
import os
import socket
import subprocess
import sys
import time
import urllib.request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 5000
HEALTH_TIMEOUT = 60


def get_port() -> int:
    """从 .env 或默认值获取端口."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("WEB_UI_PORT="):
                    try:
                        return int(line.split("=", 1)[1].strip())
                    except ValueError:
                        pass
    return DEFAULT_PORT


def is_port_in_use(host: str, port: int) -> bool:
    """检查端口是否被占用."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1)
        return s.connect_ex((host, port)) == 0


def wait_for_health(host: str, port: int, timeout: int = HEALTH_TIMEOUT) -> bool:
    """等待服务健康检查通过."""
    url = f"http://{host}:{port}/health"
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main() -> None:
    project_root = os.path.dirname(os.path.abspath(__file__))
    port = get_port()
    host = DEFAULT_HOST

    logger.info("========== Agent Zero 启动脚本 ==========")
    logger.info("项目路径: %s", project_root)
    logger.info("目标地址: http://%s:%d", host, port)

    # 检查端口占用
    if is_port_in_use(host, port):
        logger.error("端口 %d 已被占用，请先关闭占用该端口的进程或修改端口", port)
        sys.exit(1)

    # 检查 run_ui.py 是否存在
    entry = os.path.join(project_root, "run_ui.py")
    if not os.path.exists(entry):
        logger.error("找不到入口文件: %s", entry)
        sys.exit(1)

    # SSL 修复已通过 .venv/Lib/site-packages/sitecustomize.py 自动生效

    logger.info("正在启动 Agent Zero ...")
    proc = subprocess.Popen(
        [sys.executable, entry],
        cwd=project_root,
    )

    try:
        logger.info("等待服务就绪 (最长 %d 秒) ...", HEALTH_TIMEOUT)
        if wait_for_health(host, port):
            logger.info("✓ Agent Zero 启动成功！")
            logger.info("访问地址: http://%s:%d", host, port)
        else:
            logger.warning("健康检查超时，服务可能仍在初始化中，请手动检查 http://%s:%d", host, port)

        proc.wait()
    except KeyboardInterrupt:
        logger.info("收到中断信号，正在关闭 ...")
        proc.terminate()
        proc.wait(timeout=10)
        logger.info("已关闭")


if __name__ == "__main__":
    main()
