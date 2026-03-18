from python.helpers.api import ApiHandler, Input, Output, Request
from python.helpers import skills
import agent


class SkillsLoad(ApiHandler):
    """加载技能到当前对话上下文 API"""

    async def process(self, input: Input, request: Request) -> Output:
        try:
            context_id = input.get("context", "")
            skill_names = input.get("skills", [])

            if not skill_names:
                return {"ok": False, "error": "未选择任何技能"}

            # 获取当前 agent context
            ctx = agent.AgentContext.get(context_id)
            if not ctx:
                return {"ok": False, "error": "无效的对话上下文"}

            # 查找并加载技能
            all_skills = skills.list_skills(include_content=True)
            loaded = []
            not_found = []

            for name in skill_names:
                found = False
                for skill in all_skills:
                    if skill.name.lower() == name.lower():
                        # 将技能内容添加到 agent 的活动技能列表
                        if not hasattr(ctx, 'active_skills'):
                            ctx.active_skills = []
                        
                        # 避免重复添加
                        if not any(s.name == skill.name for s in ctx.active_skills):
                            ctx.active_skills.append(skill)
                        
                        loaded.append({
                            "name": skill.name,
                            "description": skill.description,
                        })
                        found = True
                        break
                
                if not found:
                    not_found.append(name)

            return {
                "ok": True,
                "loaded": loaded,
                "not_found": not_found,
                "message": f"已加载 {len(loaded)} 个技能" + (f"，{len(not_found)} 个未找到" if not_found else ""),
            }

        except Exception as e:
            return {"ok": False, "error": str(e)}
