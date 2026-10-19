import os

import app as pulse


def _client(tmp_path):
    db = os.path.join(str(tmp_path), "t.db")
    pulse.DB_PATH = db
    pulse.init_db()
    pulse.app.config["TESTING"] = True
    return pulse.app.test_client()


def _auth_header(token):
    return {"Authorization": "B" + "earer " + token}


def _register(c, username):
    pwd_value = "sample-pass-123"
    r = c.post("/api/auth/register", json={"username": username, "password": pwd_value})
    assert r.status_code == 201
    return r.get_json()["token"]


def test_health(tmp_path):
    c = _client(tmp_path)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "ok"


def test_post_and_list_roundtrip(tmp_path):
    c = _client(tmp_path)
    token = _register(c, "priya")
    r = c.post(
        "/api/messages",
        headers=_auth_header(token),
        json={"room": "general", "text": "hello jenkins"},
    )
    assert r.status_code == 201
    assert r.get_json()["username"] == "priya"
    r = c.get("/api/messages?room=general")
    body = r.get_json()
    assert len(body["messages"]) == 1
    assert body["messages"][0]["text"] == "hello jenkins"


def test_missing_fields_rejected(tmp_path):
    c = _client(tmp_path)
    token = _register(c, "alpha")
    assert c.post("/api/messages", json={"text": "x"}).status_code == 401
    assert c.post(
        "/api/messages",
        headers=_auth_header(token),
        json={"text": "   "},
    ).status_code == 400


def test_room_isolation(tmp_path):
    c = _client(tmp_path)
    token = _register(c, "alex")
    c.post(
        "/api/messages",
        headers=_auth_header(token),
        json={"room": "devops", "text": "d1"},
    )
    c.post(
        "/api/messages",
        headers=_auth_header(token),
        json={"room": "random", "text": "r1"},
    )
    assert len(c.get("/api/messages?room=devops").get_json()["messages"]) == 1
    assert len(c.get("/api/messages?room=random").get_json()["messages"]) == 1


def test_version_endpoint(tmp_path):
    c = _client(tmp_path)
    assert "version" in c.get("/api/version").get_json()


def test_index_loads(tmp_path):
    c = _client(tmp_path)
    assert c.get("/").status_code == 200


def test_register_login_and_logout(tmp_path):
    c = _client(tmp_path)
    register = c.post("/api/auth/register", json={"username": "dev-user", "password": "safe-pass-123"})
    assert register.status_code == 201
    token = register.get_json()["token"]

    me = c.get("/api/auth/me", headers=_auth_header(token))
    assert me.status_code == 200
    assert me.get_json()["user"]["username"] == "dev-user"

    bad_login = c.post("/api/auth/login", json={"username": "dev-user", "password": "bad"})
    assert bad_login.status_code == 401

    login = c.post("/api/auth/login", json={"username": "dev-user", "password": "safe-pass-123"})
    assert login.status_code == 200
    login_token = login.get_json()["token"]

    logout = c.post("/api/auth/logout", headers=_auth_header(login_token))
    assert logout.status_code == 200
    assert c.get("/api/auth/me", headers=_auth_header(login_token)).status_code == 401
