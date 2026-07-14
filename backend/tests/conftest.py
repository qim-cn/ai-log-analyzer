"""
Pytest 配置
"""

import os
import sys

# 将后端项目根目录加入 Python 路径，便于导入 app.*
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
