"""
技能管理工具 - 查看、搜索、管理 Agent Zero 技能
用法:
    python skill_manager.py              # 列出所有技能
    python skill_manager.py list         # 列出所有技能
    python skill_manager.py search TDD   # 搜索技能
    python skill_manager.py show <name>  # 显示技能详情
    python skill_manager.py tree         # 树形显示技能结构
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    yaml = None


SKILLS_DIR = Path(__file__).parent / "usr" / "skills"


@dataclass
class Skill:
    name: str
    description: str
    path: Path
    tags: list[str]
    triggers: list[str]
    version: str = ""
    author: str = ""


def parse_skill_md(path: Path) -> Skill | None:
    """解析 SKILL.md 文件"""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None

    # 解析 YAML frontmatter
    lines = text.splitlines()
    start_idx = None
    for i, line in enumerate(lines):
        if line.strip() == "---":
            start_idx = i
            break
        if line.strip():
            return None

    if start_idx is None:
        return None

    end_idx = None
    for j in range(start_idx + 1, len(lines)):
        if lines[j].strip() == "---":
            end_idx = j
            break

    if end_idx is None:
        return None

    fm_text = "\n".join(lines[start_idx + 1 : end_idx])
    
    # 解析 YAML
    fm: dict[str, Any] = {}
    if yaml:
        try:
            fm = yaml.safe_load(fm_text) or {}
        except Exception:
            pass
    
    if not fm:
        # 简单解析
        for line in fm_text.splitlines():
            if ":" in line:
                key, _, val = line.partition(":")
                fm[key.strip()] = val.strip()

    name = str(fm.get("name") or fm.get("skill") or path.parent.name).strip()
    description = str(fm.get("description") or fm.get("when_to_use") or fm.get("summary") or "").strip()
    
    tags = fm.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    
    triggers = fm.get("triggers", [])
    if isinstance(triggers, str):
        triggers = [t.strip() for t in triggers.split(",")]

    return Skill(
        name=name,
        description=description,
        path=path,
        tags=tags if isinstance(tags, list) else [],
        triggers=triggers if isinstance(triggers, list) else [],
        version=str(fm.get("version", "")),
        author=str(fm.get("author", "")),
    )


def discover_skills(root: Path) -> list[Skill]:
    """发现所有技能"""
    skills: list[Skill] = []
    if not root.exists():
        return skills

    for skill_md in root.rglob("SKILL.md"):
        if ".git" in str(skill_md):
            continue
        skill = parse_skill_md(skill_md)
        if skill:
            skills.append(skill)

    skills.sort(key=lambda s: s.name.lower())
    return skills


def cmd_list(args: argparse.Namespace) -> None:
    """列出所有技能"""
    skills = discover_skills(SKILLS_DIR)
    
    if not skills:
        print("未发现任何技能")
        return

    print(f"\n📦 共发现 {len(skills)} 个技能\n")
    print(f"{'技能名称':<35} {'描述':<50}")
    print("-" * 85)
    
    for skill in skills:
        name = skill.name[:33] + ".." if len(skill.name) > 35 else skill.name
        desc = skill.description[:48] + ".." if len(skill.description) > 50 else skill.description
        print(f"{name:<35} {desc:<50}")


def cmd_search(args: argparse.Namespace) -> None:
    """搜索技能"""
    query = args.query.lower()
    skills = discover_skills(SKILLS_DIR)
    
    matches = []
    for skill in skills:
        searchable = f"{skill.name} {skill.description} {' '.join(skill.tags)} {' '.join(skill.triggers)}".lower()
        if query in searchable:
            matches.append(skill)

    if not matches:
        print(f"未找到匹配 '{args.query}' 的技能")
        return

    print(f"\n🔍 找到 {len(matches)} 个匹配技能\n")
    for skill in matches:
        print(f"  📌 {skill.name}")
        print(f"     {skill.description[:70]}...")
        print(f"     路径: {skill.path.parent.relative_to(SKILLS_DIR)}")
        print()


def cmd_show(args: argparse.Namespace) -> None:
    """显示技能详情"""
    skills = discover_skills(SKILLS_DIR)
    
    target = args.name.lower()
    found = None
    for skill in skills:
        if skill.name.lower() == target or target in skill.name.lower():
            found = skill
            break

    if not found:
        print(f"未找到技能: {args.name}")
        return

    print(f"\n{'='*60}")
    print(f"📌 {found.name}")
    print(f"{'='*60}")
    print(f"\n📝 描述: {found.description}")
    print(f"📁 路径: {found.path}")
    
    if found.tags:
        print(f"🏷️  标签: {', '.join(found.tags)}")
    if found.triggers:
        print(f"⚡ 触发词: {', '.join(found.triggers)}")
    if found.version:
        print(f"📦 版本: {found.version}")
    if found.author:
        print(f"👤 作者: {found.author}")

    # 显示内容预览
    try:
        content = found.path.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        # 跳过 frontmatter
        in_fm = False
        body_start = 0
        for i, line in enumerate(lines):
            if line.strip() == "---":
                if not in_fm:
                    in_fm = True
                else:
                    body_start = i + 1
                    break
        
        body = "\n".join(lines[body_start:body_start+30])
        print(f"\n📄 内容预览:\n{'-'*40}")
        print(body)
        if len(lines) > body_start + 30:
            print(f"\n... (共 {len(lines) - body_start} 行)")
    except Exception:
        pass


def cmd_tree(args: argparse.Namespace) -> None:
    """树形显示技能结构"""
    skills = discover_skills(SKILLS_DIR)
    
    # 按目录分组
    groups: dict[str, list[Skill]] = {}
    for skill in skills:
        rel = skill.path.parent.relative_to(SKILLS_DIR)
        parts = rel.parts
        group = parts[0] if parts else "root"
        if group not in groups:
            groups[group] = []
        groups[group].append(skill)

    print(f"\n📂 usr/skills/")
    for group in sorted(groups.keys()):
        group_skills = groups[group]
        print(f"  📁 {group}/ ({len(group_skills)} 技能)")
        for skill in group_skills[:5]:  # 每组最多显示5个
            print(f"      📌 {skill.name}")
        if len(group_skills) > 5:
            print(f"      ... 还有 {len(group_skills) - 5} 个")


def cmd_stats(args: argparse.Namespace) -> None:
    """显示统计信息"""
    skills = discover_skills(SKILLS_DIR)
    
    # 按目录统计
    groups: dict[str, int] = {}
    for skill in skills:
        rel = skill.path.parent.relative_to(SKILLS_DIR)
        parts = rel.parts
        group = parts[0] if parts else "root"
        groups[group] = groups.get(group, 0) + 1

    print(f"\n📊 技能统计")
    print(f"{'='*40}")
    print(f"总技能数: {len(skills)}")
    print(f"技能包数: {len(groups)}")
    print(f"\n按技能包分布:")
    for group, count in sorted(groups.items(), key=lambda x: -x[1]):
        bar = "█" * min(count, 30)
        print(f"  {group:<25} {count:>3} {bar}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Agent Zero 技能管理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command")

    # list
    subparsers.add_parser("list", help="列出所有技能")
    
    # search
    p_search = subparsers.add_parser("search", help="搜索技能")
    p_search.add_argument("query", help="搜索关键词")
    
    # show
    p_show = subparsers.add_parser("show", help="显示技能详情")
    p_show.add_argument("name", help="技能名称")
    
    # tree
    subparsers.add_parser("tree", help="树形显示技能结构")
    
    # stats
    subparsers.add_parser("stats", help="显示统计信息")

    args = parser.parse_args()

    if args.command == "search":
        cmd_search(args)
    elif args.command == "show":
        cmd_show(args)
    elif args.command == "tree":
        cmd_tree(args)
    elif args.command == "stats":
        cmd_stats(args)
    else:
        # 默认显示统计 + 列表
        cmd_stats(args)
        print()
        cmd_list(args)


if __name__ == "__main__":
    main()
