from python.helpers.api import ApiHandler, Input, Output, Request
from python.helpers import skills


class SkillsList(ApiHandler):
    """获取技能列表 API - 用于前端技能选择器"""

    @classmethod
    def requires_csrf(cls) -> bool:
        return True

    async def process(self, input: Input, request: Request) -> Output:
        try:
            skill_list = skills.list_skills()

            result = []
            for skill in skill_list:
                # 提取来源目录名
                path_parts = str(skill.path).replace("\\", "/").split("/")
                source = ""
                if "usr" in path_parts and "skills" in path_parts:
                    skills_idx = path_parts.index("skills")
                    if skills_idx + 1 < len(path_parts):
                        source = path_parts[skills_idx + 1]

                result.append({
                    "name": skill.name,
                    "description": skill.description,
                    "path": str(skill.path),
                    "tags": skill.tags or [],
                    "triggers": skill.triggers or [],
                    "source": source,
                })

            # 按名称排序
            result.sort(key=lambda x: x["name"].lower())

            return {"skills": result}

        except Exception as e:
            return {"error": str(e), "skills": []}
