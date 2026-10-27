from tools import gate


def test_a_drop_within_the_allowance_above_the_floor_passes():
    drops, record = gate.compare({"go": 89.5}, {"go": 90.0})
    assert drops == [] and record == {"go": 90.0}


def test_a_drop_beyond_the_allowance_fails():
    drops, _ = gate.compare({"go": 88.5}, {"go": 90.0})
    assert drops == ["go coverage fell from 90.0% to 88.5%: test what you changed"]


def test_under_the_floor_nothing_may_fall():
    drops, _ = gate.compare({"go": 80.5}, {"go": 81.0})
    assert drops and gate.compare({"go": 80.95}, {"go": 81.0})[0] == []


def test_a_rise_is_recorded():
    assert gate.compare({"go": 91.0}, {"go": 90.0}) == ([], {"go": 91.0})
    assert gate.compare({"go": 70.0}, {}) == ([], {"go": 70.0})
