from app.evaluate import read_labels, score
from app.shots import Shot


def test_read_labels(tmp_path):
    labels = tmp_path / "labels.txt"
    labels.write_text("0:18 make\n1:05 miss\n\n")

    assert read_labels(labels) == [(18, True), (65, False)]


def test_score_pairs_shots_with_labels_released_up_to_a_few_seconds_earlier():
    labels = [(10, True), (20, False), (30, False), (40, True)]
    fps = 10
    shots = [
        Shot(110, True),  # 11 s: the 0:10 make
        Shot(225, True),  # 22.5 s: the 0:20 miss, called a make
        Shot(240, False),  # 24 s: a second sighting of the same miss
        Shot(320, False),  # 32 s: the 0:30 miss
    ]  # nothing near the 0:40 make

    result = score(shots, labels, fps)

    assert (result["found"], result["extra"], result["right"]) == (3, 1, 2)
    assert result["problems"] == [
        "0:20 miss -> called make at 0:22",
        "0:40 make -> not found",
        "extra shot at 0:24 (miss)",
    ]
