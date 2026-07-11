"""
对话导出服务

支持 Markdown 和 PDF 格式导出。
"""

from datetime import datetime

from app.middlewares.error_handler import ValidationError
from app.models.message import MessageRole
from app.repositories.message_repository import message_repository
from app.repositories.session_repository import session_repository


class ExportService:
    """对话导出服务"""

    def export_markdown(self, session_id: str) -> str:
        """
        导出为 Markdown 格式

        Args:
            session_id: 会话 ID

        Returns:
            Markdown 文本
        """
        session = session_repository.get_by_id(session_id)
        if not session:
            raise ValidationError(f"会话 {session_id} 不存在")

        messages = message_repository.get_by_session(session_id)

        lines = [
            "---",
            f"title: {session.title}",
            f"date: {datetime.utcnow().isoformat()}Z",
            f"messages: {len(messages)}",
            "---",
            "",
            f"# {session.title}",
            "",
            f"> 导出时间: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
            "",
            "---",
            "",
        ]

        for msg in messages:
            if msg.role == MessageRole.USER:
                lines.append(f"## 👤 用户")
                lines.append("")
                lines.append(msg.content)
                lines.append("")
            elif msg.role == MessageRole.ASSISTANT:
                lines.append(f"## 🤖 AI 助手")
                lines.append("")
                lines.append(msg.content)
                lines.append("")
            elif msg.role == MessageRole.SYSTEM:
                lines.append(f"## ⚙️ 系统")
                lines.append("")
                lines.append(msg.content)
                lines.append("")

            lines.append("---")
            lines.append("")

        return "\n".join(lines)

    def export_pdf(self, session_id: str) -> bytes:
        """
        导出为 PDF 格式

        Args:
            session_id: 会话 ID

        Returns:
            PDF 字节数据
        """
        # 先生成 Markdown
        md_content = self.export_markdown(session_id)

        # 尝试使用 weasyprint 转换
        try:
            from weasyprint import HTML

            # Markdown 转 HTML
            html_content = self._markdown_to_html(md_content)
            pdf_bytes = HTML(string=html_content).write_pdf()
            return pdf_bytes
        except ImportError:
            # weasyprint 未安装，使用简单的 HTML 转换
            html_content = self._markdown_to_html(md_content)
            # 返回 HTML 作为备选
            return html_content.encode("utf-8")

    def _markdown_to_html(self, md_content: str) -> str:
        """简单的 Markdown 转 HTML"""
        lines = md_content.split("\n")
        html_lines = []
        in_code_block = False

        for line in lines:
            # 跳过 frontmatter
            if line == "---":
                continue

            # 标题
            if line.startswith("# "):
                html_lines.append(f"<h1>{line[2:]}</h1>")
            elif line.startswith("## "):
                html_lines.append(f"<h2>{line[3:]}</h2>")
            elif line.startswith("### "):
                html_lines.append(f"<h3>{line[4:]}</h3>")
            # 引用
            elif line.startswith("> "):
                html_lines.append(f"<blockquote>{line[2:]}</blockquote>")
            # 分隔线
            elif line == "---":
                html_lines.append("<hr>")
            # 代码块
            elif line.startswith("```"):
                if in_code_block:
                    html_lines.append("</code></pre>")
                    in_code_block = False
                else:
                    html_lines.append("<pre><code>")
                    in_code_block = True
            # 普通文本
            elif line.strip():
                # 粗体
                import re
                line = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
                # 行内代码
                line = re.sub(r"`(.+?)`", r"<code>\1</code>", line)
                html_lines.append(f"<p>{line}</p>")
            else:
                html_lines.append("")

        html_body = "\n".join(html_lines)

        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }}
        h1 {{ color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }}
        h2 {{ color: #555; margin-top: 30px; }}
        h3 {{ color: #666; }}
        pre {{ background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }}
        code {{ background: #f0f0f0; padding: 2px 5px; border-radius: 3px; }}
        blockquote {{ border-left: 4px solid #ddd; margin: 0; padding: 10px 20px; color: #666; }}
        hr {{ border: none; border-top: 1px solid #eee; margin: 20px 0; }}
        p {{ line-height: 1.6; }}
    </style>
</head>
<body>
{html_body}
</body>
</html>"""


# 全局实例
export_service = ExportService()
