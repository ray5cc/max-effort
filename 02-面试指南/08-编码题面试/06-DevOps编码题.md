# DevOps 编码题

> 涵盖 Shell 脚本、容器化、CI/CD、基础设施即代码等 DevOps 核心编程题，难度分层，配有完整脚本实现和解题思路。

## 相关链接
- 对应技术资料：[编码技巧与解题策略](../../01-技术资料/08-编码题/01-编码技巧与解题策略.md)
- DevOps技术资料：[DevOps与云计算文档](../../01-技术资料/06-DevOps与云计算/)

## 目录
1. [⭐ 基础题](#⭐-基础题)
2. [⭐⭐ 进阶题](#⭐⭐-进阶题)
3. [⭐⭐⭐ 高级题](#⭐⭐⭐-高级题)
4. [🎯 场景题](#🎯-场景题)

---

## ⭐ 基础题

### 1. 实现日志分析脚本

**题目：** 编写 Shell 脚本分析 Nginx 访问日志，统计 Top 10 访问IP、URL、状态码。

**思路：**
- 使用 awk、sort、uniq 等命令
- 管道组合处理文本

**实现（Bash）：**

```bash
#!/bin/bash

LOG_FILE="${1:-/var/log/nginx/access.log}"

if [ ! -f "$LOG_FILE" ]; then
    echo "Error: Log file not found: $LOG_FILE"
    exit 1
fi

echo "=== Nginx Log Analysis ==="
echo "Log file: $LOG_FILE"
echo

# 1. Top 10 访问IP
echo "Top 10 IP Addresses:"
awk '{print $1}' "$LOG_FILE" | \
    sort | \
    uniq -c | \
    sort -rn | \
    head -10 | \
    awk '{printf "%-15s %10s requests\n", $2, $1}'
echo

# 2. Top 10 访问URL
echo "Top 10 URLs:"
awk '{print $7}' "$LOG_FILE" | \
    sort | \
    uniq -c | \
    sort -rn | \
    head -10 | \
    awk '{printf "%-50s %10s requests\n", $2, $1}'
echo

# 3. 状态码统计
echo "Status Code Distribution:"
awk '{print $9}' "$LOG_FILE" | \
    sort | \
    uniq -c | \
    sort -rn | \
    awk '{printf "Status %s: %10s requests\n", $2, $1}'
echo

# 4. 每小时请求量
echo "Requests Per Hour:"
awk '{print substr($4, 14, 2)}' "$LOG_FILE" | \
    sort | \
    uniq -c | \
    awk '{printf "Hour %s:00 - %10s requests\n", $2, $1}'
echo

# 5. 响应时间分析（如果日志包含响应时间）
echo "Average Response Time (if available):"
if awk '{print $NF}' "$LOG_FILE" | head -1 | grep -qE '^[0-9]+\.?[0-9]*$'; then
    awk '{sum+=$NF; count++} END {if(count>0) printf "Average: %.3f seconds\n", sum/count}' "$LOG_FILE"
else
    echo "Response time not found in log format"
fi
echo

# 6. 统计 4xx 和 5xx 错误
echo "Error Summary:"
awk '$9 ~ /^4/ {e4xx++} $9 ~ /^5/ {e5xx++} END {
    printf "4xx errors: %d\n", e4xx+0;
    printf "5xx errors: %d\n", e5xx+0
}' "$LOG_FILE"
echo

# 7. 带宽使用（字节数）
echo "Total Bandwidth Usage:"
awk '{sum+=$10} END {
    printf "Total: %.2f MB\n", sum/1024/1024;
    printf "Average per request: %.2f KB\n", sum/NR/1024
}' "$LOG_FILE"
```

**Python 版本：**

```python
#!/usr/bin/env python3
import sys
import re
from collections import Counter, defaultdict

def parse_nginx_log(log_file):
    """解析 Nginx 日志"""
    ip_counter = Counter()
    url_counter = Counter()
    status_counter = Counter()
    hour_counter = Counter()
    response_times = []
    total_bytes = 0

    # Nginx 日志正则表达式
    log_pattern = re.compile(
        r'(\S+) - - \[(\d{2}/\w{3}/\d{4}:\d{2}):(\d{2}):\d{2} [+\-]\d{4}\] '
        r'"(\w+) (\S+) HTTP/\d\.\d" (\d{3}) (\d+)(?: "([^"]*)" "([^"]*)")?'
    )

    try:
        with open(log_file, 'r') as f:
            for line in f:
                match = log_pattern.match(line)
                if match:
                    ip = match.group(1)
                    hour = match.group(3)
                    url = match.group(5)
                    status = match.group(6)
                    bytes_sent = int(match.group(7))

                    ip_counter[ip] += 1
                    url_counter[url] += 1
                    status_counter[status] += 1
                    hour_counter[hour] += 1
                    total_bytes += bytes_sent

    except FileNotFoundError:
        print(f"Error: File not found: {log_file}")
        sys.exit(1)

    return {
        'ip': ip_counter,
        'url': url_counter,
        'status': status_counter,
        'hour': hour_counter,
        'total_bytes': total_bytes,
        'total_requests': sum(ip_counter.values())
    }

def print_report(data):
    """打印分析报告"""
    print("=== Nginx Log Analysis ===\n")

    # Top 10 IP
    print("Top 10 IP Addresses:")
    for ip, count in data['ip'].most_common(10):
        print(f"{ip:<15} {count:>10} requests")
    print()

    # Top 10 URL
    print("Top 10 URLs:")
    for url, count in data['url'].most_common(10):
        print(f"{url:<50} {count:>10} requests")
    print()

    # 状态码分布
    print("Status Code Distribution:")
    for status, count in sorted(data['status'].items()):
        print(f"Status {status}: {count:>10} requests")
    print()

    # 每小时请求量
    print("Requests Per Hour:")
    for hour in sorted(data['hour'].keys()):
        count = data['hour'][hour]
        print(f"Hour {hour}:00 - {count:>10} requests")
    print()

    # 错误统计
    error_4xx = sum(count for status, count in data['status'].items() if status.startswith('4'))
    error_5xx = sum(count for status, count in data['status'].items() if status.startswith('5'))
    print("Error Summary:")
    print(f"4xx errors: {error_4xx}")
    print(f"5xx errors: {error_5xx}")
    print()

    # 带宽统计
    total_mb = data['total_bytes'] / 1024 / 1024
    avg_kb = data['total_bytes'] / data['total_requests'] / 1024 if data['total_requests'] > 0 else 0
    print("Bandwidth Usage:")
    print(f"Total: {total_mb:.2f} MB")
    print(f"Average per request: {avg_kb:.2f} KB")

if __name__ == "__main__":
    log_file = sys.argv[1] if len(sys.argv) > 1 else "/var/log/nginx/access.log"
    data = parse_nginx_log(log_file)
    print_report(data)
```

**关键点：**
1. awk 处理文本效率高
2. 管道组合多个命令
3. Python 版本更灵活，适合复杂逻辑

---

### 2. 实现自动化部署脚本

**题目：** 编写脚本实现应用的自动化部署（拉取代码、构建、停止旧服务、启动新服务）。

**实现（Bash）：**

```bash
#!/bin/bash

set -e  # 遇到错误立即退出

# 配置
APP_NAME="myapp"
APP_DIR="/opt/myapp"
GIT_REPO="https://github.com/user/myapp.git"
GIT_BRANCH="main"
BUILD_CMD="npm install && npm run build"
START_CMD="npm start"
LOG_FILE="/var/log/myapp/deploy.log"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

# 检查命令是否存在
check_command() {
    if ! command -v "$1" &> /dev/null; then
        error "Command not found: $1"
    fi
}

# 备份当前版本
backup() {
    log "Creating backup..."
    BACKUP_DIR="${APP_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
    if [ -d "$APP_DIR" ]; then
        cp -r "$APP_DIR" "$BACKUP_DIR"
        log "Backup created: $BACKUP_DIR"
    else
        warn "No existing deployment to backup"
    fi
}

# 拉取代码
pull_code() {
    log "Pulling code from $GIT_REPO (branch: $GIT_BRANCH)..."

    if [ -d "$APP_DIR/.git" ]; then
        cd "$APP_DIR"
        git fetch origin
        git checkout "$GIT_BRANCH"
        git pull origin "$GIT_BRANCH"
    else
        rm -rf "$APP_DIR"
        git clone -b "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
    fi

    cd "$APP_DIR"
    COMMIT_HASH=$(git rev-parse --short HEAD)
    log "Current commit: $COMMIT_HASH"
}

# 构建应用
build() {
    log "Building application..."
    cd "$APP_DIR"

    # 执行构建命令
    eval "$BUILD_CMD" || error "Build failed"

    log "Build completed successfully"
}

# 停止旧服务
stop_service() {
    log "Stopping old service..."

    # 使用 systemd
    if systemctl is-active --quiet "$APP_NAME"; then
        systemctl stop "$APP_NAME"
        log "Service stopped via systemd"
    # 或使用进程管理器（pm2）
    elif command -v pm2 &> /dev/null && pm2 list | grep -q "$APP_NAME"; then
        pm2 stop "$APP_NAME"
        log "Service stopped via pm2"
    # 或直接杀进程
    else
        pkill -f "$APP_NAME" || warn "No running process found"
    fi
}

# 启动新服务
start_service() {
    log "Starting new service..."

    cd "$APP_DIR"

    # 使用 systemd
    if [ -f "/etc/systemd/system/${APP_NAME}.service" ]; then
        systemctl start "$APP_NAME"
        systemctl status "$APP_NAME" --no-pager
    # 或使用 pm2
    elif command -v pm2 &> /dev/null; then
        pm2 start "$START_CMD" --name "$APP_NAME"
        pm2 save
    # 或后台运行
    else
        nohup $START_CMD > /var/log/myapp/app.log 2>&1 &
        echo $! > /var/run/myapp.pid
    fi

    log "Service started successfully"
}

# 健康检查
health_check() {
    log "Performing health check..."

    local max_attempts=30
    local attempt=0
    local health_url="http://localhost:3000/health"

    while [ $attempt -lt $max_attempts ]; do
        if curl -f -s "$health_url" > /dev/null; then
            log "Health check passed"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 2
    done

    error "Health check failed after $max_attempts attempts"
}

# 回滚
rollback() {
    error "Deployment failed, rolling back..."

    if [ -d "${APP_DIR}_backup"* ]; then
        LATEST_BACKUP=$(ls -td "${APP_DIR}_backup"* | head -1)
        rm -rf "$APP_DIR"
        mv "$LATEST_BACKUP" "$APP_DIR"
        start_service
        log "Rollback completed"
    else
        error "No backup found for rollback"
    fi
}

# 主流程
main() {
    log "Starting deployment of $APP_NAME..."

    # 检查依赖
    check_command git
    check_command curl

    # 备份
    backup

    # 部署流程
    pull_code && \
    build && \
    stop_service && \
    start_service && \
    health_check || rollback

    log "Deployment completed successfully!"
}

# 执行
main
```

**关键点：**
1. 错误处理（set -e）
2. 日志记录
3. 备份和回滚机制
4. 健康检查

---

### 3. 实现系统监控脚本

**题目：** 编写脚本监控系统资源使用（CPU、内存、磁盘、网络），超过阈值发送告警。

**实现（Python）：**

```python
#!/usr/bin/env python3

import psutil
import time
import smtplib
from email.mime.text import MIMEText
from datetime import datetime

class SystemMonitor:
    def __init__(self, config):
        self.config = config
        self.alert_cooldown = {}

    def check_cpu(self):
        """检查 CPU 使用率"""
        cpu_percent = psutil.cpu_percent(interval=1)
        threshold = self.config['cpu_threshold']

        if cpu_percent > threshold:
            self.send_alert(
                f"CPU 使用率过高",
                f"当前 CPU 使用率: {cpu_percent}% (阈值: {threshold}%)"
            )

        return cpu_percent

    def check_memory(self):
        """检查内存使用率"""
        memory = psutil.virtual_memory()
        mem_percent = memory.percent
        threshold = self.config['memory_threshold']

        if mem_percent > threshold:
            self.send_alert(
                f"内存使用率过高",
                f"当前内存使用率: {mem_percent}% (阈值: {threshold}%)\n"
                f"已使用: {memory.used / (1024**3):.2f} GB\n"
                f"总容量: {memory.total / (1024**3):.2f} GB"
            )

        return mem_percent

    def check_disk(self):
        """检查磁盘使用率"""
        alerts = []

        for partition in psutil.disk_partitions():
            try:
                usage = psutil.disk_usage(partition.mountpoint)
                percent = usage.percent
                threshold = self.config['disk_threshold']

                if percent > threshold:
                    self.send_alert(
                        f"磁盘空间不足: {partition.mountpoint}",
                        f"当前使用率: {percent}% (阈值: {threshold}%)\n"
                        f"已使用: {usage.used / (1024**3):.2f} GB\n"
                        f"总容量: {usage.total / (1024**3):.2f} GB"
                    )

                alerts.append({
                    'mountpoint': partition.mountpoint,
                    'percent': percent
                })
            except PermissionError:
                pass

        return alerts

    def check_network(self):
        """检查网络流量"""
        net_io = psutil.net_io_counters()

        return {
            'bytes_sent': net_io.bytes_sent,
            'bytes_recv': net_io.bytes_recv,
            'packets_sent': net_io.packets_sent,
            'packets_recv': net_io.packets_recv
        }

    def check_processes(self):
        """检查高资源使用进程"""
        top_cpu = []
        top_mem = []

        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                info = proc.info
                top_cpu.append((info['name'], info['cpu_percent']))
                top_mem.append((info['name'], info['memory_percent']))
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        top_cpu = sorted(top_cpu, key=lambda x: x[1], reverse=True)[:5]
        top_mem = sorted(top_mem, key=lambda x: x[1], reverse=True)[:5]

        return {'cpu': top_cpu, 'memory': top_mem}

    def send_alert(self, subject, message):
        """发送告警（邮件/钉钉/短信等）"""
        alert_key = subject
        current_time = time.time()

        # 冷却时间，避免重复告警
        if alert_key in self.alert_cooldown:
            if current_time - self.alert_cooldown[alert_key] < 300:  # 5分钟内不重复
                return

        self.alert_cooldown[alert_key] = current_time

        print(f"\n{'='*50}")
        print(f"ALERT: {subject}")
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*50}")
        print(message)
        print(f"{'='*50}\n")

        # 发送邮件
        if self.config.get('email_enabled'):
            self._send_email(subject, message)

    def _send_email(self, subject, message):
        """发送邮件告警"""
        try:
            msg = MIMEText(message, 'plain', 'utf-8')
            msg['Subject'] = f"[System Alert] {subject}"
            msg['From'] = self.config['email_from']
            msg['To'] = self.config['email_to']

            with smtplib.SMTP(self.config['smtp_server'], self.config['smtp_port']) as server:
                if self.config.get('smtp_use_tls'):
                    server.starttls()
                server.login(self.config['smtp_user'], self.config['smtp_password'])
                server.send_message(msg)

            print("Email alert sent successfully")
        except Exception as e:
            print(f"Failed to send email: {e}")

    def generate_report(self):
        """生成系统监控报告"""
        print(f"\n{'='*60}")
        print(f"System Monitor Report - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*60}")

        # CPU
        cpu_percent = self.check_cpu()
        print(f"\nCPU Usage: {cpu_percent}%")

        cpu_freq = psutil.cpu_freq()
        if cpu_freq:
            print(f"CPU Frequency: {cpu_freq.current:.2f} MHz")

        # 内存
        mem_percent = self.check_memory()
        memory = psutil.virtual_memory()
        print(f"\nMemory Usage: {mem_percent}%")
        print(f"  Total: {memory.total / (1024**3):.2f} GB")
        print(f"  Used: {memory.used / (1024**3):.2f} GB")
        print(f"  Free: {memory.available / (1024**3):.2f} GB")

        # 磁盘
        print("\nDisk Usage:")
        disk_alerts = self.check_disk()
        for disk in disk_alerts:
            print(f"  {disk['mountpoint']}: {disk['percent']}%")

        # 网络
        net_stats = self.check_network()
        print("\nNetwork Stats:")
        print(f"  Bytes Sent: {net_stats['bytes_sent'] / (1024**2):.2f} MB")
        print(f"  Bytes Received: {net_stats['bytes_recv'] / (1024**2):.2f} MB")

        # Top 进程
        top_procs = self.check_processes()
        print("\nTop 5 CPU Processes:")
        for name, cpu in top_procs['cpu']:
            print(f"  {name}: {cpu}%")

        print("\nTop 5 Memory Processes:")
        for name, mem in top_procs['memory']:
            print(f"  {name}: {mem:.2f}%")

        print(f"{'='*60}\n")

    def run(self, interval=60):
        """持续监控"""
        print(f"System monitor started (interval: {interval}s)")
        print(f"CPU threshold: {self.config['cpu_threshold']}%")
        print(f"Memory threshold: {self.config['memory_threshold']}%")
        print(f"Disk threshold: {self.config['disk_threshold']}%")

        try:
            while True:
                self.generate_report()
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\nMonitor stopped by user")

# 配置
config = {
    'cpu_threshold': 80,
    'memory_threshold': 85,
    'disk_threshold': 90,
    'email_enabled': False,
    'email_from': 'monitor@example.com',
    'email_to': 'admin@example.com',
    'smtp_server': 'smtp.example.com',
    'smtp_port': 587,
    'smtp_use_tls': True,
    'smtp_user': 'user',
    'smtp_password': 'password'
}

# 运行
if __name__ == "__main__":
    monitor = SystemMonitor(config)
    monitor.run(interval=60)
```

**关键点：**
1. 使用 psutil 获取系统信息
2. 阈值检查和告警
3. 告警冷却机制
4. 定期生成报告

---

## ⭐⭐ 进阶题

### 4. 实现简单的 CI/CD Pipeline

**题目：** 使用 Python 实现一个简单的 CI/CD 流水线。

**实现：**

```python
#!/usr/bin/env python3

import os
import subprocess
import yaml
import json
from datetime import datetime
from pathlib import Path

class Pipeline:
    def __init__(self, config_file):
        with open(config_file, 'r') as f:
            self.config = yaml.safe_load(f)

        self.project_name = self.config['project']['name']
        self.workspace = Path(self.config['project']['workspace'])
        self.logs = []

    def log(self, message, level='INFO'):
        """记录日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] [{level}] {message}"
        print(log_entry)
        self.logs.append(log_entry)

    def run_command(self, command, cwd=None, env=None):
        """执行命令"""
        self.log(f"Executing: {command}")

        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd or self.workspace,
                env=env or os.environ.copy(),
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.stdout:
                self.log(f"STDOUT:\n{result.stdout}")
            if result.stderr:
                self.log(f"STDERR:\n{result.stderr}")

            if result.returncode != 0:
                raise Exception(f"Command failed with code {result.returncode}")

            return result

        except subprocess.TimeoutExpired:
            raise Exception(f"Command timeout: {command}")
        except Exception as e:
            self.log(f"Command failed: {e}", 'ERROR')
            raise

    def stage_checkout(self):
        """Stage 1: 拉取代码"""
        self.log("=== Stage: Checkout ===", 'INFO')

        git_config = self.config['stages']['checkout']
        repo = git_config['repository']
        branch = git_config.get('branch', 'main')

        if not self.workspace.exists():
            self.workspace.mkdir(parents=True)

        if (self.workspace / '.git').exists():
            self.run_command('git fetch origin')
            self.run_command(f'git checkout {branch}')
            self.run_command(f'git pull origin {branch}')
        else:
            self.run_command(f'git clone -b {branch} {repo} .')

        # 获取提交信息
        result = self.run_command('git log -1 --pretty=format:"%H %an %s"')
        self.log(f"Current commit: {result.stdout}")

    def stage_build(self):
        """Stage 2: 构建"""
        self.log("=== Stage: Build ===", 'INFO')

        build_config = self.config['stages']['build']
        commands = build_config.get('commands', [])

        for cmd in commands:
            self.run_command(cmd)

        self.log("Build completed successfully")

    def stage_test(self):
        """Stage 3: 测试"""
        self.log("=== Stage: Test ===", 'INFO')

        test_config = self.config['stages']['test']
        commands = test_config.get('commands', [])

        for cmd in commands:
            self.run_command(cmd)

        # 解析测试报告（假设生成了 JUnit XML）
        report_path = self.workspace / 'test-results.xml'
        if report_path.exists():
            self.log(f"Test report found: {report_path}")

    def stage_docker_build(self):
        """Stage 4: Docker 构建"""
        self.log("=== Stage: Docker Build ===", 'INFO')

        docker_config = self.config['stages'].get('docker')
        if not docker_config:
            self.log("Docker stage not configured, skipping")
            return

        image_name = docker_config['image']
        dockerfile = docker_config.get('dockerfile', 'Dockerfile')

        # 构建镜像
        tag = f"{image_name}:{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        self.run_command(f'docker build -t {tag} -f {dockerfile} .')

        # 打 latest 标签
        self.run_command(f'docker tag {tag} {image_name}:latest')

        # 推送镜像
        if docker_config.get('push', False):
            self.run_command(f'docker push {tag}')
            self.run_command(f'docker push {image_name}:latest')

        self.log(f"Docker image built: {tag}")

    def stage_deploy(self):
        """Stage 5: 部署"""
        self.log("=== Stage: Deploy ===", 'INFO')

        deploy_config = self.config['stages'].get('deploy')
        if not deploy_config:
            self.log("Deploy stage not configured, skipping")
            return

        environment = deploy_config.get('environment', 'production')
        commands = deploy_config.get('commands', [])

        self.log(f"Deploying to {environment}...")

        for cmd in commands:
            self.run_command(cmd)

        self.log(f"Deployment to {environment} completed")

    def stage_notify(self, success):
        """Stage 6: 通知"""
        self.log("=== Stage: Notify ===", 'INFO')

        notify_config = self.config['stages'].get('notify', {})

        if notify_config.get('slack'):
            self._send_slack_notification(success)

        if notify_config.get('email'):
            self._send_email_notification(success)

    def _send_slack_notification(self, success):
        """发送 Slack 通知"""
        webhook_url = os.environ.get('SLACK_WEBHOOK_URL')
        if not webhook_url:
            self.log("Slack webhook URL not configured")
            return

        status = "SUCCESS" if success else "FAILED"
        color = "good" if success else "danger"

        payload = {
            "attachments": [{
                "color": color,
                "title": f"Pipeline {status}: {self.project_name}",
                "fields": [
                    {"title": "Project", "value": self.project_name, "short": True},
                    {"title": "Status", "value": status, "short": True}
                ],
                "footer": "CI/CD Pipeline",
                "ts": int(datetime.now().timestamp())
            }]
        }

        import requests
        requests.post(webhook_url, json=payload)
        self.log("Slack notification sent")

    def _send_email_notification(self, success):
        """发送邮件通知"""
        self.log("Email notification (not implemented)")

    def run(self):
        """运行完整流水线"""
        self.log(f"Starting pipeline for {self.project_name}")
        start_time = datetime.now()

        try:
            self.stage_checkout()
            self.stage_build()
            self.stage_test()
            self.stage_docker_build()
            self.stage_deploy()

            success = True
            self.log("Pipeline completed successfully", 'INFO')

        except Exception as e:
            success = False
            self.log(f"Pipeline failed: {e}", 'ERROR')

        finally:
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            self.log(f"Pipeline duration: {duration:.2f} seconds")

            self.stage_notify(success)

            # 保存日志
            self._save_logs()

            if not success:
                exit(1)

    def _save_logs(self):
        """保存日志到文件"""
        log_dir = Path('pipeline-logs')
        log_dir.mkdir(exist_ok=True)

        log_file = log_dir / f"{self.project_name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
        with open(log_file, 'w') as f:
            f.write('\n'.join(self.logs))

        self.log(f"Logs saved to {log_file}")

# 配置文件示例 (pipeline.yml)
"""
project:
  name: myapp
  workspace: /tmp/myapp

stages:
  checkout:
    repository: https://github.com/user/myapp.git
    branch: main

  build:
    commands:
      - npm install
      - npm run build

  test:
    commands:
      - npm run test
      - npm run lint

  docker:
    image: myorg/myapp
    dockerfile: Dockerfile
    push: true

  deploy:
    environment: production
    commands:
      - kubectl apply -f k8s/deployment.yml
      - kubectl rollout status deployment/myapp

  notify:
    slack: true
    email: true
"""

# 运行
if __name__ == "__main__":
    import sys
    config_file = sys.argv[1] if len(sys.argv) > 1 else "pipeline.yml"
    pipeline = Pipeline(config_file)
    pipeline.run()
```

**关键点：**
1. 阶段化执行
2. 错误处理和回滚
3. 日志记录
4. 通知机制

---

## ⭐⭐⭐ 高级题

### 5. 实现 Kubernetes Operator

**题目：** 使用 Python 实现一个简单的 Kubernetes Operator，监听自定义资源并执行相应操作。

**实现：**

```python
#!/usr/bin/env python3

from kubernetes import client, config, watch
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AppOperator:
    """
    简单的 Kubernetes Operator
    监听 App CRD 资源并创建对应的 Deployment 和 Service
    """

    def __init__(self):
        # 加载 kubeconfig
        try:
            config.load_incluster_config()
        except:
            config.load_kube_config()

        self.api = client.ApiClient()
        self.apps_v1 = client.AppsV1Api()
        self.core_v1 = client.CoreV1Api()
        self.custom_api = client.CustomObjectsApi()

        self.group = "example.com"
        self.version = "v1"
        self.plural = "apps"

    def watch_resources(self):
        """监听自定义资源变化"""
        logger.info("Starting to watch App resources...")

        w = watch.Watch()

        try:
            for event in w.stream(
                self.custom_api.list_cluster_custom_object,
                group=self.group,
                version=self.version,
                plural=self.plural
            ):
                event_type = event['type']
                obj = event['object']

                logger.info(f"Event: {event_type} for {obj['metadata']['name']}")

                if event_type == 'ADDED':
                    self.handle_create(obj)
                elif event_type == 'MODIFIED':
                    self.handle_update(obj)
                elif event_type == 'DELETED':
                    self.handle_delete(obj)

        except Exception as e:
            logger.error(f"Watch error: {e}")
            time.sleep(5)
            self.watch_resources()

    def handle_create(self, app):
        """处理资源创建"""
        name = app['metadata']['name']
        namespace = app['metadata'].get('namespace', 'default')
        spec = app['spec']

        logger.info(f"Creating resources for App: {name}")

        try:
            # 创建 Deployment
            self._create_deployment(name, namespace, spec)

            # 创建 Service
            self._create_service(name, namespace, spec)

            # 更新 App 状态
            self._update_status(name, namespace, "Running")

        except Exception as e:
            logger.error(f"Failed to create resources: {e}")
            self._update_status(name, namespace, "Failed")

    def handle_update(self, app):
        """处理资源更新"""
        name = app['metadata']['name']
        namespace = app['metadata'].get('namespace', 'default')
        spec = app['spec']

        logger.info(f"Updating resources for App: {name}")

        try:
            # 更新 Deployment
            self._update_deployment(name, namespace, spec)

            self._update_status(name, namespace, "Running")

        except Exception as e:
            logger.error(f"Failed to update resources: {e}")

    def handle_delete(self, app):
        """处理资源删除"""
        name = app['metadata']['name']
        namespace = app['metadata'].get('namespace', 'default')

        logger.info(f"Deleting resources for App: {name}")

        try:
            # 删除 Deployment
            self.apps_v1.delete_namespaced_deployment(
                name=name,
                namespace=namespace,
                body=client.V1DeleteOptions()
            )

            # 删除 Service
            self.core_v1.delete_namespaced_service(
                name=name,
                namespace=namespace,
                body=client.V1DeleteOptions()
            )

        except Exception as e:
            logger.error(f"Failed to delete resources: {e}")

    def _create_deployment(self, name, namespace, spec):
        """创建 Deployment"""
        deployment = client.V1Deployment(
            api_version="apps/v1",
            kind="Deployment",
            metadata=client.V1ObjectMeta(
                name=name,
                labels={"app": name}
            ),
            spec=client.V1DeploymentSpec(
                replicas=spec.get('replicas', 1),
                selector=client.V1LabelSelector(
                    match_labels={"app": name}
                ),
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={"app": name}
                    ),
                    spec=client.V1PodSpec(
                        containers=[
                            client.V1Container(
                                name=name,
                                image=spec['image'],
                                ports=[
                                    client.V1ContainerPort(
                                        container_port=spec.get('port', 8080)
                                    )
                                ],
                                env=[
                                    client.V1EnvVar(name=k, value=v)
                                    for k, v in spec.get('env', {}).items()
                                ]
                            )
                        ]
                    )
                )
            )
        )

        self.apps_v1.create_namespaced_deployment(
            namespace=namespace,
            body=deployment
        )

        logger.info(f"Deployment created: {name}")

    def _create_service(self, name, namespace, spec):
        """创建 Service"""
        service = client.V1Service(
            api_version="v1",
            kind="Service",
            metadata=client.V1ObjectMeta(
                name=name,
                labels={"app": name}
            ),
            spec=client.V1ServiceSpec(
                selector={"app": name},
                ports=[
                    client.V1ServicePort(
                        port=spec.get('port', 8080),
                        target_port=spec.get('port', 8080)
                    )
                ],
                type=spec.get('serviceType', 'ClusterIP')
            )
        )

        self.core_v1.create_namespaced_service(
            namespace=namespace,
            body=service
        )

        logger.info(f"Service created: {name}")

    def _update_deployment(self, name, namespace, spec):
        """更新 Deployment"""
        deployment = self.apps_v1.read_namespaced_deployment(name, namespace)

        # 更新副本数
        deployment.spec.replicas = spec.get('replicas', 1)

        # 更新镜像
        deployment.spec.template.spec.containers[0].image = spec['image']

        self.apps_v1.patch_namespaced_deployment(
            name=name,
            namespace=namespace,
            body=deployment
        )

        logger.info(f"Deployment updated: {name}")

    def _update_status(self, name, namespace, status):
        """更新 App 状态"""
        try:
            body = {
                "status": {
                    "state": status,
                    "lastUpdateTime": time.strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }

            self.custom_api.patch_namespaced_custom_object_status(
                group=self.group,
                version=self.version,
                namespace=namespace,
                plural=self.plural,
                name=name,
                body=body
            )

            logger.info(f"Status updated: {name} -> {status}")

        except Exception as e:
            logger.error(f"Failed to update status: {e}")

    def run(self):
        """运行 Operator"""
        logger.info("App Operator started")

        while True:
            try:
                self.watch_resources()
            except KeyboardInterrupt:
                logger.info("Operator stopped by user")
                break
            except Exception as e:
                logger.error(f"Operator error: {e}")
                time.sleep(5)

# CRD 示例 (app-crd.yaml)
"""
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: apps.example.com
spec:
  group: example.com
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                image:
                  type: string
                replicas:
                  type: integer
                port:
                  type: integer
                env:
                  type: object
                  additionalProperties:
                    type: string
            status:
              type: object
              properties:
                state:
                  type: string
                lastUpdateTime:
                  type: string
  scope: Namespaced
  names:
    plural: apps
    singular: app
    kind: App
"""

# App 资源示例 (myapp.yaml)
"""
apiVersion: example.com/v1
kind: App
metadata:
  name: myapp
spec:
  image: nginx:latest
  replicas: 3
  port: 80
  env:
    ENV: production
"""

if __name__ == "__main__":
    operator = AppOperator()
    operator.run()
```

**关键点：**
1. Watch API 监听资源变化
2. 根据CRD 创建对应资源
3. 状态管理和错误处理
4. 幂等性设计

---

## 🎯 场景题

### 6. 实现蓝绿部署脚本

**题目：** 实现 Kubernetes 环境下的蓝绿部署。

**实现（Python）：**

```python
#!/usr/bin/env python3

from kubernetes import client, config
import time
import sys

class BlueGreenDeployment:
    def __init__(self, namespace="default"):
        config.load_kube_config()
        self.apps_v1 = client.AppsV1Api()
        self.core_v1 = client.CoreV1Api()
        self.namespace = namespace

    def deploy(self, app_name, image, port=8080):
        """执行蓝绿部署"""
        print(f"Starting blue-green deployment for {app_name}")

        # 1. 获取当前活跃颜色
        current_color = self._get_active_color(app_name)
        new_color = "green" if current_color == "blue" else "blue"

        print(f"Current active: {current_color}, deploying to: {new_color}")

        # 2. 部署新版本
        new_deployment_name = f"{app_name}-{new_color}"
        self._create_or_update_deployment(
            new_deployment_name,
            image,
            port,
            new_color
        )

        # 3. 等待新版本就绪
        print(f"Waiting for {new_deployment_name} to be ready...")
        self._wait_for_deployment(new_deployment_name)

        # 4. 健康检查
        if not self._health_check(new_deployment_name, port):
            print("Health check failed, rolling back...")
            self._delete_deployment(new_deployment_name)
            return False

        # 5. 切换流量
        print(f"Switching traffic to {new_color}...")
        self._update_service(app_name, new_color, port)

        # 6. 删除旧版本
        old_deployment_name = f"{app_name}-{current_color}"
        print(f"Deleting old deployment: {old_deployment_name}")
        time.sleep(5)  # 等待流量完全切换
        self._delete_deployment(old_deployment_name)

        print("Blue-green deployment completed successfully!")
        return True

    def _get_active_color(self, app_name):
        """获取当前活跃颜色"""
        try:
            service = self.core_v1.read_namespaced_service(
                name=app_name,
                namespace=self.namespace
            )
            return service.spec.selector.get('color', 'blue')
        except:
            return 'blue'  # 默认从 blue 开始

    def _create_or_update_deployment(self, name, image, port, color):
        """创建或更新 Deployment"""
        deployment = client.V1Deployment(
            metadata=client.V1ObjectMeta(name=name),
            spec=client.V1DeploymentSpec(
                replicas=3,
                selector=client.V1LabelSelector(
                    match_labels={"app": name, "color": color}
                ),
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={"app": name, "color": color}
                    ),
                    spec=client.V1PodSpec(
                        containers=[
                            client.V1Container(
                                name=name,
                                image=image,
                                ports=[client.V1ContainerPort(container_port=port)],
                                readiness_probe=client.V1Probe(
                                    http_get=client.V1HTTPGetAction(
                                        path="/health",
                                        port=port
                                    ),
                                    initial_delay_seconds=5,
                                    period_seconds=5
                                )
                            )
                        ]
                    )
                )
            )
        )

        try:
            self.apps_v1.create_namespaced_deployment(
                namespace=self.namespace,
                body=deployment
            )
            print(f"Deployment created: {name}")
        except client.rest.ApiException as e:
            if e.status == 409:  # Already exists
                self.apps_v1.patch_namespaced_deployment(
                    name=name,
                    namespace=self.namespace,
                    body=deployment
                )
                print(f"Deployment updated: {name}")
            else:
                raise

    def _wait_for_deployment(self, name, timeout=300):
        """等待 Deployment 就绪"""
        start_time = time.time()

        while time.time() - start_time < timeout:
            deployment = self.apps_v1.read_namespaced_deployment(
                name=name,
                namespace=self.namespace
            )

            if (deployment.status.ready_replicas and
                deployment.status.ready_replicas == deployment.spec.replicas):
                print(f"Deployment {name} is ready")
                return True

            time.sleep(5)

        raise Exception(f"Deployment {name} not ready after {timeout}s")

    def _health_check(self, deployment_name, port):
        """健康检查"""
        # 获取 Pod
        pods = self.core_v1.list_namespaced_pod(
            namespace=self.namespace,
            label_selector=f"app={deployment_name}"
        )

        if not pods.items:
            return False

        # 简化：假设第一个 Pod 代表整体健康状态
        pod = pods.items[0]
        return pod.status.phase == "Running"

    def _update_service(self, app_name, color, port):
        """更新 Service 指向新版本"""
        service = client.V1Service(
            metadata=client.V1ObjectMeta(name=app_name),
            spec=client.V1ServiceSpec(
                selector={"color": color},
                ports=[client.V1ServicePort(port=port, target_port=port)],
                type="LoadBalancer"
            )
        )

        try:
            self.core_v1.create_namespaced_service(
                namespace=self.namespace,
                body=service
            )
            print(f"Service created: {app_name}")
        except client.rest.ApiException as e:
            if e.status == 409:
                self.core_v1.patch_namespaced_service(
                    name=app_name,
                    namespace=self.namespace,
                    body=service
                )
                print(f"Service updated: {app_name}")
            else:
                raise

    def _delete_deployment(self, name):
        """删除 Deployment"""
        try:
            self.apps_v1.delete_namespaced_deployment(
                name=name,
                namespace=self.namespace
            )
            print(f"Deployment deleted: {name}")
        except client.rest.ApiException as e:
            if e.status != 404:
                raise

# 使用
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 blue_green_deploy.py <app-name> <image> [port]")
        sys.exit(1)

    app_name = sys.argv[1]
    image = sys.argv[2]
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 8080

    deployer = BlueGreenDeployment()
    success = deployer.deploy(app_name, image, port)

    sys.exit(0 if success else 1)
```

**关键点：**
1. 部署新版本到非活跃环境
2. 健康检查确保新版本正常
3. Service 切换流量
4. 删除旧版本

---

## 总结

DevOps 编码题考察自动化、脚本编写、容器编排等实战能力。

**学习建议：**
1. 熟练掌握 Shell/Python 脚本
2. 理解 CI/CD 流程
3. 掌握 Docker 和 Kubernetes
4. 熟悉 Git、Jenkins、GitLab CI
5. 了解监控和日志系统

**最佳实践：**
1. 自动化一切
2. 基础设施即代码
3. 不可变基础设施
4. 持续集成/持续部署
5. 监控和告警

**扩展阅读：**
- 《DevOps 实践指南》
- 《Kubernetes 权威指南》
- 《持续交付》
- 《凤凰项目》
- Docker 和 K8s 官方文档
