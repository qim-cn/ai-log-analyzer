"""
MaskingService 单元测试
"""

from app.services.masking_service import LogMasker, MaskingService, summarize_mapping


def _mask(text: str):
    return MaskingService().mask_text(text)


def test_mask_ipv4():
    masked, mapping = _mask("连接 192.168.1.100 失败，回退到 10.0.0.1")
    assert "192.168.1.100" not in masked
    assert "10.0.0.1" not in masked
    assert "[IP_1]" in masked
    assert "[IP_2]" in masked
    assert mapping["[IP_1]"] == "192.168.1.100"
    assert mapping["[IP_2]"] == "10.0.0.1"


def test_mask_cn_phone():
    masked, mapping = _mask("用户 13812345678 提交失败")
    assert "13812345678" not in masked
    assert "[PHONE_1]" in masked
    assert mapping["[PHONE_1]"] == "13812345678"


def test_mask_email():
    masked, mapping = _mask("告警发送至 admin@example.com")
    assert "admin@example.com" not in masked
    assert "[EMAIL_1]" in masked
    assert mapping["[EMAIL_1]"] == "admin@example.com"


def test_mask_jwt_and_bearer():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQ"
    masked, mapping = _mask(f"Authorization: Bearer {jwt}")
    assert jwt not in masked
    assert masked.startswith("Bearer [TOKEN_1]") or "Bearer [TOKEN_1]" in masked
    assert mapping["[TOKEN_1]"] == jwt

    # 裸 JWT 也能脱敏
    masked2, _ = _mask(f"token is {jwt}")
    assert jwt not in masked2


def test_mask_api_key_forms():
    # sk- 形态
    masked, mapping = _mask("调用失败 key=sk-abcdefghijklmnop1234")
    assert "sk-abcdefghijklmnop1234" not in masked
    assert "[APIKEY_1]" in masked

    # key=value 形态：保留键名，只替换值
    masked, _ = _mask("api_key=abcdef1234567890 超时")
    assert "abcdef1234567890" not in masked
    assert "api_key=" in masked

    masked, _ = _mask("token: zzzzz99999 secret=mypassword1")
    assert "zzzzz99999" not in masked
    assert "mypassword1" not in masked


def test_mask_id_card():
    masked, mapping = _mask("身份证 110101199003077758 校验失败")
    assert "110101199003077758" not in masked
    assert "[IDCARD_1]" in masked
    assert mapping["[IDCARD_1]"] == "110101199003077758"


def test_id_card_not_misread_as_phone():
    """18 位身份证号不能被手机号规则截断命中"""
    masked, mapping = _mask("id=110101199003077758")
    assert "[IDCARD_1]" in masked
    assert "[IDCARD_1]" in mapping
    assert not any(k.startswith("[PHONE") for k in mapping)


def test_same_value_same_placeholder():
    text = "ping 8.8.8.8 超时，重试 8.8.8.8 仍超时，而 1.1.1.1 正常"
    masked, mapping = _mask(text)
    assert masked.count("[IP_1]") == 2
    assert masked.count("[IP_2]") == 1
    assert len(mapping) == 2


def test_masker_state_shared_across_chunks():
    """流式场景：同一 LogMasker 跨分块保持映射一致"""
    masker = LogMasker()
    part1 = masker.mask("ERROR from 192.168.0.1")
    part2 = masker.mask("retry 192.168.0.1 again")
    assert "[IP_1]" in part1
    assert "[IP_1]" in part2
    assert masker.mapping == {"[IP_1]": "192.168.0.1"}


def test_no_sensitive_data_returns_unchanged():
    text = "2024-01-15 10:30:00 INFO 服务启动完成\n2024-01-15 10:30:01 ERROR 磁盘已满"
    masked, mapping = _mask(text)
    assert masked == text
    assert mapping == {}


def test_password_like_kv_masked_but_key_kept():
    masked, _ = _mask('connect failed: host=db01 password="S3cret!pass"')
    assert "S3cret!pass" not in masked
    assert "password=" in masked


def test_summarize_mapping_counts_by_category():
    mapping = {
        "[IP_1]": "192.168.1.1",
        "[IP_2]": "10.0.0.1",
        "[PHONE_1]": "13812345678",
        "[EMAIL_1]": "a@b.com",
    }
    stats = summarize_mapping(mapping)
    assert stats == {"IP": 2, "PHONE": 1, "EMAIL": 1}


def test_summarize_mapping_empty():
    assert summarize_mapping({}) == {}


def test_summarize_mapping_unknown_placeholder():
    stats = summarize_mapping({"not-a-placeholder": "x"})
    assert stats == {"OTHER": 1}
