"""
对话导出路由

GET /api/sessions/:id/export?format=markdown → 导出 Markdown
GET /api/sessions/:id/export?format=pdf → 导出 PDF
"""

from fastapi import APIRouter
from fastapi.responses import Response

from app.middlewares.error_handler import ValidationError
from app.services.export_service import export_service

router = APIRouter()


@router.get("/{session_id}/export")
async def export_session(session_id: str, format: str = "markdown"):
    """
    导出会话

    Query Params:
        format: markdown 或 pdf
    """
    if format not in ("markdown", "pdf"):
        raise ValidationError("格式只支持 markdown 或 pdf")

    if format == "markdown":
        content = export_service.export_markdown(session_id)
        return Response(
            content=content,
            media_type="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{session_id}.md"'
            },
        )
    else:
        content = export_service.export_pdf(session_id)
        media_type = "application/pdf" if format == "pdf" else "text/html"
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{session_id}.pdf"'
            },
        )
