#!/usr/bin/env python3
"""
Validate B9's allowlisted Roblox skills for size and structure compliance.

Vendored from jakesixtyoneeighty/roblox-brain at commit
71036b0b7cc4d140c116900658cf42e44ae551aa and distributed under the MIT
license reproduced in skills/NOTICE.md.

Selected workflow skills are adapted from obra/superpowers v6.1.1 under the
MIT license reproduced in skills/NOTICE.md.

Checks:
- SKILL.md under 3,000 chars
- references/full.md under 35,000 chars
- Description under 150 chars
- Frontmatter has name, description, last_reviewed, sources
- sources field is not empty (use [original] for synthesis)
- '## When to Load' section exists
- '## Quick Reference' section exists
- No '## Overview' or '## 1. Overview' in SKILL.md
- No '## Full Reference' in SKILL.md (should be in references/)
- No unbalanced or nested fenced code blocks
- references/full.md exists (router skills exempt)
- Cross-references (backtick-enclosed `roblox-X`) point to existing skills
- Local `references/...` links point to real files
- Supporting files under `references/` are linked from the skill

Exit code 0 = all checks pass, 1 = failures found.
"""

import os
import re
import sys
from pathlib import Path

MAX_SKILL_CHARS = 3000
MAX_DESC_CHARS = 150
MAX_REF_CHARS = 35000
REPO_ROOT = Path(__file__).resolve().parent
SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")


def parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from SKILL.md as a flat key-to-value dict.

    Multi-line 'description: >' blocks are joined into one string.
    List-valued fields like 'sources:' keep only the first list item as
    a marker; check for field existence with `field in fm`.
    """
    match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
    if not match:
        return {}
    fm = {}
    body = match.group(1)
    desc_match = re.search(
        r"^description:\s*>\s*\n((?:\s+.+\n?)+)", body, re.MULTILINE
    )
    if desc_match:
        fm["description"] = " ".join(desc_match.group(1).split())
    for line in body.split("\n"):
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        if key == "description":
            if "description" not in fm:
                fm["description"] = val.strip().strip("\"'")
            continue
        if key.startswith("  -") or key.startswith("-"):
            continue
        fm[key] = val.strip()
    return fm


def extract_description(content: str) -> str:
    """Get the description string from frontmatter."""
    return parse_frontmatter(content).get("description", "")


def validate_code_fences(content: str, label: str) -> list[str]:
    """Reject unclosed fences and language-tagged nested openings."""
    errors = []
    fence_pattern = re.compile(r"^ *```([^` ]*)? *$")
    open_line = None
    open_language = ""

    for line_number, line in enumerate(content.splitlines(), 1):
        match = fence_pattern.match(line)
        if not match:
            continue
        language = match.group(1) or ""
        if open_line is None:
            open_line = line_number
            open_language = language
        elif language:
            errors.append(
                f"{label}:{line_number}: nested fenced block '{language}' "
                f"inside {open_language or 'untyped'} fence opened at line {open_line}"
            )
        else:
            open_line = None
            open_language = ""

    if open_line is not None:
        errors.append(
            f"{label}:{open_line}: unclosed {open_language or 'untyped'} fenced block"
        )
    return errors


def validate_skill(skill_dir: str) -> list[str]:
    """Validate a single skill directory."""
    errors = []
    skill_name = os.path.basename(skill_dir)
    skill_md = os.path.join(skill_dir, "SKILL.md")

    if not os.path.exists(skill_md):
        return [f"{skill_name}: SKILL.md not found"]

    with open(skill_md, encoding="utf-8") as file:
        content = file.read()

    if len(content) > MAX_SKILL_CHARS:
        errors.append(
            f"{skill_name}: SKILL.md is {len(content)} chars (max {MAX_SKILL_CHARS})"
        )

    fm = parse_frontmatter(content)
    for field in ("name", "description", "last_reviewed", "sources"):
        if field not in fm:
            errors.append(f"{skill_name}: missing frontmatter field '{field}'")

    desc = extract_description(content)
    if len(desc) > MAX_DESC_CHARS:
        errors.append(
            f"{skill_name}: description is {len(desc)} chars (max {MAX_DESC_CHARS})"
        )

    if "## When to Load" not in content:
        errors.append(f"{skill_name}: missing '## When to Load' section")
    if "## Quick Reference" not in content:
        errors.append(f"{skill_name}: missing '## Quick Reference' section")
    if "## Full Reference" in content:
        errors.append(
            f"{skill_name}: '## Full Reference' found in SKILL.md "
            "(move to references/)"
        )

    ref_path = os.path.join(skill_dir, "references", "full.md")
    is_router = "router" in desc.lower()
    if not is_router and not os.path.exists(ref_path):
        errors.append(f"{skill_name}: missing references/full.md")

    if not is_router and os.path.exists(ref_path):
        with open(ref_path, encoding="utf-8") as file:
            ref_content = file.read()
        if len(ref_content) > MAX_REF_CHARS:
            errors.append(
                f"{skill_name}: references/full.md is {len(ref_content)} chars "
                f"(max {MAX_REF_CHARS})"
            )

    if re.search(r"^##\s+(?:1\.\s+)?Overview\s*$", content, re.MULTILINE):
        errors.append(
            f"{skill_name}: '## Overview' found in SKILL.md "
            "(use When to Load and Quick Reference)"
        )

    if re.search(r"```lua *$", content, re.MULTILINE):
        errors.append(f"{skill_name}: found ```lua code block (use ```luau instead)")
    errors.extend(validate_code_fences(content, f"{skill_name}: SKILL.md"))

    if not is_router and os.path.exists(ref_path):
        with open(ref_path, encoding="utf-8") as file:
            ref_content = file.read()
        if re.search(r"```lua *$", ref_content, re.MULTILINE):
            errors.append(
                f"{skill_name}: found ```lua code block in references/full.md "
                "(use ```luau instead)"
            )
        errors.extend(
            validate_code_fences(
                ref_content, f"{skill_name}: references/full.md"
            )
        )

    if "sources" in fm:
        fm_match = re.match(r"^---\n(.+?)\n---", content, re.DOTALL)
        if fm_match:
            sources_match = re.search(
                r"^sources:\s*\[\]?\s*$", fm_match.group(1), re.MULTILINE
            )
            if sources_match:
                errors.append(
                    f"{skill_name}: sources is empty "
                    "(use [original] for synthesis, or cite real sources)"
                )

    return errors


def collect_all_skill_names() -> set[str]:
    """Return the skill directory names."""
    return {
        entry
        for entry in os.listdir(SKILLS_DIR)
        if os.path.isdir(os.path.join(SKILLS_DIR, entry))
    }


def validate_cross_references(all_skill_names: set[str]) -> list[str]:
    """Find references to skills that do not exist."""
    errors = []
    ref_pattern = re.compile(r"`?(roblox-[a-z]+(?:-[a-z]+)*)`?(?:\s*→|\s*\|)")
    for entry in sorted(os.listdir(SKILLS_DIR)):
        skill_dir = os.path.join(SKILLS_DIR, entry)
        if not os.path.isdir(skill_dir):
            continue
        for filepath in [
            os.path.join(skill_dir, "SKILL.md"),
            os.path.join(skill_dir, "references", "full.md"),
        ]:
            if not os.path.exists(filepath):
                continue
            with open(filepath, encoding="utf-8") as file:
                content = file.read()
            fm_match = re.match(r"^---\n.+?\n---\n?", content, re.DOTALL)
            body = content[fm_match.end() :] if fm_match else content
            for match in ref_pattern.finditer(body):
                ref_name = match.group(1)
                if ref_name not in all_skill_names:
                    line_num = body[: match.start()].count("\n") + 1
                    errors.append(
                        f"{entry}: references non-existent skill '{ref_name}' "
                        f"at {os.path.basename(filepath)}:{line_num}"
                    )
    return errors


def _resolve_local_reference(filepath: Path, reference: str) -> Path:
    """Resolve a reference from SKILL.md or references/full.md."""
    reference = reference.lstrip("./")
    if filepath.parent.name == "references" and reference.startswith(
        "references/"
    ):
        return filepath.parent.parent / reference
    return filepath.parent / reference


def _local_reference_matches(filepath: Path, content: str):
    """Yield local reference paths in a document."""
    patterns = [
        re.compile(r"\]\((?!https?://|mailto:|#)([^)#\s]+)"),
        re.compile(
            r"(?<![\w/])references/[A-Za-z0-9_.-]+"
            r"(?:/[A-Za-z0-9_.-]+)*\.(?:md|luau)(?![\w])"
        ),
    ]
    seen = set()
    for pattern in patterns:
        for match in pattern.finditer(content):
            reference = match.group(1) if pattern is patterns[0] else match.group(0)
            reference = reference.strip("<>")
            if not reference.startswith("references/") or reference in seen:
                continue
            seen.add(reference)
            yield reference, match.start()


def validate_local_references() -> list[str]:
    """Ensure local references mentioned by skills exist."""
    errors = []
    for skill_dir in sorted(Path(SKILLS_DIR).iterdir()):
        if not skill_dir.is_dir():
            continue
        documents = [skill_dir / "SKILL.md"]
        full_reference = skill_dir / "references" / "full.md"
        if full_reference.exists():
            documents.append(full_reference)
        for filepath in documents:
            content = filepath.read_text(encoding="utf-8")
            for reference, position in _local_reference_matches(filepath, content):
                target = _resolve_local_reference(filepath, reference)
                if not target.is_file():
                    line = content[:position].count("\n") + 1
                    errors.append(
                        f"{skill_dir.name}: missing local reference '{reference}' "
                        f"at {filepath.relative_to(REPO_ROOT)}:{line}"
                    )
    return errors


def validate_reference_resources() -> list[str]:
    """Reject unlinked resource files under a skill's references directory."""
    errors = []
    for skill_dir in sorted(Path(SKILLS_DIR).iterdir()):
        if not skill_dir.is_dir():
            continue
        references_dir = skill_dir / "references"
        if not references_dir.is_dir():
            continue
        documents = [skill_dir / "SKILL.md", references_dir / "full.md"]
        searchable = "\n".join(
            path.read_text(encoding="utf-8") for path in documents if path.is_file()
        )
        for resource in sorted(references_dir.rglob("*")):
            if not resource.is_file() or resource.name == "full.md":
                continue
            relative = resource.relative_to(skill_dir).as_posix()
            if relative not in searchable:
                errors.append(
                    f"{skill_dir.name}: unlinked reference resource '{relative}'"
                )
    return errors


def main():
    if not os.path.isdir(SKILLS_DIR):
        print(f"Error: skills directory not found: {SKILLS_DIR}")
        sys.exit(1)

    all_errors = []
    skill_count = 0

    for entry in sorted(os.listdir(SKILLS_DIR)):
        skill_dir = os.path.join(SKILLS_DIR, entry)
        if not os.path.isdir(skill_dir):
            continue
        skill_count += 1
        all_errors.extend(validate_skill(skill_dir))

    all_skill_names = collect_all_skill_names()
    all_errors.extend(validate_cross_references(all_skill_names))
    all_errors.extend(validate_local_references())
    all_errors.extend(validate_reference_resources())

    print(f"Validated {skill_count} skills")

    if all_errors:
        print(f"\nFAILED: {len(all_errors)} error(s):\n")
        for error in all_errors:
            print(f"  - {error}")
        sys.exit(1)

    print("All checks passed")
    sys.exit(0)


if __name__ == "__main__":
    main()
