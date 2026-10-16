import os
import tempfile

import app as pulse


def _client(tmp_path):
    db = os.path.join(str(tmp_path), "t.db")
    pulse.DB_PATH = db
    pulse.init_db()
    pulse.app.config["TESTING"] = True
    return pulse.app.test_client()


def test_health(tmp_path):
    c = _client(tmp_path)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"


def test_post_and_list_roundtrip(tmp_path):
    c = _client(tmp_path)
    r = c.post("/api/messages", json={"username": "priya", "room": "general", "text": "hello jenkins"})
    assert r.status_code == 201
    r = c.get("/api/messages?room=general")
    body = r.get_json()
    assert len(body["messages"]) == 1
    assert body["messages"][0]["text"] == "hello jenkins"


def test_missing_fields_rejected(tmp_path):
    c = _client(tmp_path)
    assert c.post("/api/messages", json={"username": "", "text": "x"}).status_code == 400
    assert c.post("/api/messages", json={"username": "a", "text": "   "}).status_code == 400


def test_room_isolation(tmp_path):
    c = _client(tmp_path)
    c.post("/api/messages", json={"username": "a", "room": "devops", "text": "d1"})
    c.post("/api/messages", json={"username": "b", "room": "random", "text": "r1"})
    assert len(c.get("/api/messages?room=devops").get_json()["messages"]) == 1
    assert len(c.get("/api/messages?room=random").get_json()["messages"]) == 1


def test_version_endpoint(tmp_path):
    c = _client(tmp_path)
    assert "version" in c.get("/api/version").get_json()


def test_index_loads(tmp_path):
    c = _client(tmp_path)
    assert c.get("/").status_code == 200
