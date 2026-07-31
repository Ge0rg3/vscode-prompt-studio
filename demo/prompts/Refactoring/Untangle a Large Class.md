# Untangle a Large Class

{{class_name}} in {{file_path}} is doing too many jobs. Work out what they are before suggesting any
code.

1. List the distinct responsibilities you can see. Name each one in a few words.
2. For each, list the fields and methods that belong to it. Note anything that lands in two groups.
3. Say which group is the real class and which ones are passengers.
4. Give me an order to pull them out in, one commit at a time. The tree has to compile after each.

Start with whichever group touches the fewest shared fields. Where two responsibilities share state, tell
me what that state actually is - it is usually the thing holding the class together.

Do not rewrite the whole file. I want the plan, then we do step one.
