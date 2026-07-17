"""
Pytest 配置
"""

import os
import sys

# 测试环境显式注入 JWT_SECRET（auth_service 启动时强制校验）
os.environ.setdefault(
    "JWT_SECRET", "test-secret-key-for-unit-tests-only-32bytes!"
)

# 将后端项目根目录加入 Python 路径，便于导入 app.*
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
