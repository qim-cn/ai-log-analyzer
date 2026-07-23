"""
sop_routes 路由单元测试
"""

from types import SimpleNamespace

import pytest

from app.middlewares.error_handler import ValidationError
from app.routes.sop_routes import generate_sop, GenerateSopRequest


def _req():
    return SimpleNamespace(state=SimpleNamespace(user=SimpleNamespace(id="u1")))


async def test_empty_model_rejected():
    with pytest.raises(ValidationError, match="不能为空"):
        await generate_sop(GenerateSopRequest(model="", fault="内存ECC"), _req())


async def test_empty_fault_rejected():
    with pytest.raises(ValidationError, match="不能为空"):
        await generate_sop(GenerateSopRequest(model="7500S", fault=""), _req())
