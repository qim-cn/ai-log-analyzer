"""
对比相关的 Pydantic 类型定义
"""

from pydantic import BaseModel


class CompareRequest(BaseModel):
    """对比请求"""
    log_id_1: str
    log_id_2: str


class CompareResponse(BaseModel):
    """对比响应"""
    total_lines_1: int
    total_lines_2: int
    added_lines: int
    removed_lines: int
    modified_lines: int
    unchanged_lines: int
    new_errors: list[str]
    fixed_errors: list[str]
    changed_params: list[str]
    diff_lines: list[dict]
    summary: str
