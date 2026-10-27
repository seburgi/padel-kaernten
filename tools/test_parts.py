from tools import parts


def test_every_path_has_a_part():
    assert (
        parts.unsorted(
            [
                "services/api/go.mod",
                "api/openapi.yaml",
                "tools/gate.py",
                "docs/design/x.md",
                "services/app/package.json",
            ]
        )
        == []
    )
    assert parts.unsorted(["scratch/notes.txt"]) == [
        "scratch/notes.txt: no part in tools/parts.py claims it, so nothing would test it"
    ]


def test_go_changes_deploy_and_docs_do_not():
    assert parts.needed(["services/api/cmd/api/main.go"]) == {"go": True, "app": False, "tools": False, "deploy": True}
    assert parts.needed(["services/app/src/App.tsx"]) == {"go": False, "app": True, "tools": False, "deploy": True}
    assert parts.needed(["api/openapi.yaml"]) == {"go": True, "app": True, "tools": False, "deploy": True}
    assert parts.needed(["docs/design/slots.md"]) == {"go": False, "app": False, "tools": False, "deploy": False}
    assert parts.needed(["Dockerfile"]) == {"go": True, "app": True, "tools": True, "deploy": True}
    assert parts.needed(["tools/checks.py"]) == {"go": True, "app": True, "tools": True, "deploy": False}
