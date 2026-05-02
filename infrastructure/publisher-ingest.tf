resource "aws_dynamodb_table" "publishers" {
  name         = "chq-publishers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "publisher_events" {
  name         = "chq-publisher-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "publisherId"
  range_key    = "eventId"

  attribute {
    name = "publisherId"
    type = "S"
  }

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "state"
    type = "S"
  }

  global_secondary_index {
    name            = "by-state"
    hash_key        = "state"
    range_key       = "publisherId"
    projection_type = "ALL"
  }
}
