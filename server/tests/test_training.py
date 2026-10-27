from training.autolabel import category_for, is_plausible, to_coco_annotation
from training.collect import licensed_images, tagged_image_ids
from training.train import flip_annotations, split_ids

CC_BY = "https://creativecommons.org/licenses/by/2.0/"


def test_tagged_image_ids_keeps_confirmed_basketball_tags_only():
    rows = [
        {"ImageID": "a", "LabelName": "/m/0h8jh3r", "Confidence": "1"},  # hoop, confirmed
        {"ImageID": "d", "LabelName": "/m/0frqg3", "Confidence": "1.0"},  # ball, confirmed (other spelling)
        {"ImageID": "b", "LabelName": "/m/0h8jh3r", "Confidence": "0.0"},  # hoop, rejected by a human
        {"ImageID": "c", "LabelName": "/m/01226z", "Confidence": "1"},  # football
    ]
    assert tagged_image_ids(rows) == {"a", "d"}


def test_licensed_images_keeps_only_cc_by_images_that_were_tagged():
    rows = [
        {"ImageID": "a", "License": CC_BY},
        {"ImageID": "b", "License": "https://creativecommons.org/licenses/by-nc/2.0/"},
        {"ImageID": "c", "License": CC_BY},
    ]
    assert [r["ImageID"] for r in licensed_images(rows, {"a", "b"})] == ["a"]


def test_category_for_maps_prompt_phrases():
    assert category_for("basketball rim") == 1
    assert category_for("rim") == 1
    assert category_for("basketball hoop") == 1
    assert category_for("basketball") == 0
    assert category_for("") is None


def test_is_plausible_rejects_people_shaped_and_huge_boxes():
    assert is_plausible((100, 100, 140, 138), 0, 1000, 800)  # round ball
    assert not is_plausible((100, 100, 140, 300), 0, 1000, 800)  # tall: a person, not a ball
    assert is_plausible((100, 100, 200, 140), 1, 1000, 800)  # rim seen from the side
    assert not is_plausible((0, 0, 900, 400), 1, 1000, 800)  # covers 45% of the image
    assert not is_plausible((10, 10, 10, 30), 0, 1000, 800)  # zero width


def test_to_coco_annotation_converts_corners_to_xywh():
    a = to_coco_annotation((10, 20, 40, 60), 1, image_id=3, annotation_id=7)
    assert a["bbox"] == [10, 20, 30, 40]
    assert a["area"] == 1200
    assert (a["id"], a["image_id"], a["category_id"]) == (7, 3, 1)


def test_flip_annotations_mirrors_boxes():
    flipped = flip_annotations([{"bbox": [10, 5, 30, 20], "category_id": 0}], image_width=100)
    assert flipped == [{"bbox": [60, 5, 30, 20], "category_id": 0}]


def test_split_ids_is_repeatable_and_disjoint():
    train, val = split_ids(range(100), 0.1)
    assert len(val) == 10 and len(train) == 90
    assert not set(train) & set(val)
    assert split_ids(range(100), 0.1) == (train, val)
